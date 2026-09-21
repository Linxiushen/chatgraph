package app.chatgraph.mobile;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Native Android share receiver with an explicit, origin-bound workspace handoff. */
public final class MainActivity extends Activity {
    private static final int PICK_FILE = 71;
    private static final int INK = Color.rgb(31, 49, 42), GREEN = Color.rgb(54, 95, 81), PAPER = Color.rgb(244, 245, 239);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ShareStore store;
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private String workspace = "", banner = "", handoffId = "", handoffNonce = "";
    private boolean receiving = false, handoffRunning = false;
    private int receiveCount = 0;
    private String currentReceiveToken = "";

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        store = new ShareStore(this);
        workspace = getPreferences(MODE_PRIVATE).getString("workspace", "");
        WebView.setWebContentsDebuggingEnabled(false);
        showHome(); if (saved == null || !saved.getBoolean("share_consumed", false)) receive(getIntent());
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); receive(intent); }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }
    private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(INK); view.setPadding(0, dp(6), 0, dp(6)); return view;
    }
    private Button button(String label, Runnable action) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setTextColor(GREEN); view.setMinHeight(dp(48)); view.setOnClickListener(v -> action.run()); return view;
    }
    private void applyInsets(View view) {
        view.setOnApplyWindowInsetsListener((target, insets) -> {
            target.setPadding(dp(18) + insets.getSystemWindowInsetLeft(), dp(10) + insets.getSystemWindowInsetTop(), dp(18) + insets.getSystemWindowInsetRight(), dp(12) + insets.getSystemWindowInsetBottom());
            return insets;
        });
    }
    private void showHome() {
        if (isFinishing() || isDestroyed()) return;
        destroyWeb(); handoffId = ""; handoffNonce = ""; handoffRunning = false;
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(PAPER);
        LinearLayout body = column(); applyInsets(body); scroll.addView(body);
        ImageView icon = new ImageView(this); icon.setImageResource(app.chatgraph.mobile.R.drawable.chatgraph_icon);
        LinearLayout.LayoutParams iconSize = new LinearLayout.LayoutParams(dp(68), dp(68)); iconSize.topMargin = dp(20); iconSize.bottomMargin = dp(12); body.addView(icon, iconSize);
        body.addView(text("ChatGraph", 32)); body.addView(text("把一段对话，变成可复用的知识。", 17));
        body.addView(text("在其他 App 的分享菜单选择 ChatGraph，接收文字或一个 TXT / Markdown / JSON 文件。仅分享链接时，需要继续补充对话原文。", 14));
        if (!banner.isEmpty()) { TextView notice = text(banner, 14); notice.setTextColor(GREEN); body.addView(notice); }
        if (receiving) body.addView(text("正在安全保存到本机…", 14));
        body.addView(text("我的工作区", 21));
        body.addView(text("填入你部署的 ChatGraph HTTPS 根地址。AI 生成由该工作区处理，首次打开可能需要登录。", 14));
        EditText address = new EditText(this); address.setSingleLine(true); address.setHint("https://你的工作区域名"); address.setText(workspace); address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); address.setTextSize(15); body.addView(address);
        body.addView(button("保存工作区地址", () -> {
            try {
                String next = validateWorkspace(address.getText().toString());
                if (!workspace.isEmpty() && !workspace.equals(next)) confirm("切换工作区", "将退出当前工作区，并清除 App 内网页的登录和存储。本机待导入内容会保留。", () -> saveWorkspace(next));
                else saveWorkspace(next);
            } catch (Exception error) { alert(error.getMessage()); }
        }));
        Button open = button("打开工作区", () -> openWorkspace("")); open.setEnabled(!workspace.isEmpty()); body.addView(open);
        body.addView(text("本机待导入", 21));
        List<JSONObject> items = store.list();
        if (items.isEmpty()) body.addView(text("还没有待导入内容。可从其他 App 分享，也可打开工作区粘贴或选择文件。", 14));
        for (JSONObject item : items) {
            String id = item.optString("id");
            String title = item.optString("title"); if (title.trim().isEmpty()) title = item.optString("fileName"); if (title.trim().isEmpty()) title = "一段待整理的对话";
            TextView heading = text(title, 17); heading.setMaxLines(3); body.addView(heading);
            body.addView(text(String.format(Locale.CHINA, "%s · %.1f KB · 仅存于本机", item.optString("fileName").isEmpty() ? "文字 / 链接" : "文件", item.optLong("bytes") / 1024.0), 13));
            Button send = button("导入这份内容", () -> openWorkspace(id)); send.setEnabled(!workspace.isEmpty() && !receiving); body.addView(send);
            Button remove = button("删除这份内容", () -> confirm("删除待导入内容", "这会从本机收件箱移除这份内容。", () -> {
                try { store.remove(id); banner = "已删除。"; showHome(); } catch (Exception error) { alert("暂时无法删除，请重试。"); }
            })); remove.setEnabled(!receiving); body.addView(remove);
        }
        body.addView(text("内容会保留到导入成功或手动删除。传入工作区后，网页收件箱按其 24 小时规则清理。ChatGraph 无法读取其他 App 的历史聊天。", 13));
        Button clear = button("清除全部本机待导入内容", () -> confirm("清空本机收件箱", "此操作会删除尚未导入的内容。", () -> { store.clear(); banner = "本机收件箱已清空。"; showHome(); })); clear.setEnabled(!receiving && !items.isEmpty()); body.addView(clear);
        body.addView(button("忘记工作区并退出登录", () -> confirm("忘记工作区", "清除地址、网页登录和网页存储。本机待导入内容仍保留。", () -> { workspace = ""; getPreferences(MODE_PRIVATE).edit().remove("workspace").apply(); clearWebStorage(); banner = "工作区设置已清除。"; showHome(); })));
        body.addView(text("Android 测试版 0.4.1-beta.1 · 不包含云服务或 API 密钥", 12));
        setContentView(scroll);
    }
    static String validateWorkspace(String value) throws Exception {
        URI uri = new URI(value.trim());
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/")) || uri.getPort() == 0 || uri.getPort() > 65535)
            throw new IOException("请输入完整的 HTTPS 根地址，例如 https://graph.example.com；不要填写路径、密码或访问令牌。");
        return new URI("https", null, host.toLowerCase(Locale.ROOT), uri.getPort() == 443 ? -1 : uri.getPort(), null, null, null).toASCIIString();
    }
    private void saveWorkspace(String next) {
        if (!workspace.equals(next)) clearWebStorage();
        workspace = next; getPreferences(MODE_PRIVATE).edit().putString("workspace", workspace).apply(); banner = "工作区地址已保存。"; showHome();
    }
    private void clearWebStorage() {
        CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush(); WebStorage.getInstance().deleteAllData();
        if (web != null) { web.clearCache(true); web.clearHistory(); }
        else { WebView temporary = new WebView(this); temporary.clearCache(true); temporary.destroy(); }
    }
    private void receive(Intent intent) {
        if (intent == null || (!Intent.ACTION_SEND.equals(intent.getAction()) && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) return;
        final Intent received = new Intent(intent);
        final String receiveToken = UUID.randomUUID().toString(); currentReceiveToken = receiveToken;
        receiveCount++; receiving = true; showHome();
        worker.execute(() -> {
            String outcome;
            try {
                ArrayList<Uri> uris = new ArrayList<>();
                if (Intent.ACTION_SEND_MULTIPLE.equals(received.getAction())) {
                    ArrayList<Uri> extras = received.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if (extras != null) uris.addAll(extras);
                } else {
                    Uri uri = received.getParcelableExtra(Intent.EXTRA_STREAM); if (uri != null) uris.add(uri);
                }
                // Some providers use ClipData instead of EXTRA_STREAM. Do not treat text clips as files.
                if (uris.isEmpty() && received.getClipData() != null) for (int i = 0; i < received.getClipData().getItemCount(); i++) {
                    Uri uri = received.getClipData().getItemAt(i).getUri(); if (uri != null) uris.add(uri);
                }
                if (uris.size() > 1) throw new IOException("一次只接收一个对话文件，请分别分享。");
                CharSequence extraTitle = received.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
                String title = extraTitle == null ? "" : extraTitle.toString(); if (title.length() > 200) title = title.substring(0, 200);
                String fileName = "", content;
                if (!uris.isEmpty()) {
                    Uri uri = uris.get(0);
                    if (!"content".equals(uri.getScheme())) throw new IOException("仅接收由系统分享的内容文件，请通过文件 App 重新分享。");
                    try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            fileName = cursor.getString(0);
                            if (!cursor.isNull(1) && cursor.getLong(1) > ShareStore.FILE_LIMIT) throw new IOException("单个对话文件不能超过 25 MB。");
                        }
                    }
                    if (fileName == null || fileName.length() > 200 || !fileName.matches("(?i).+\\.(txt|md|markdown|json)")) throw new IOException("请选择 TXT、Markdown 或 JSON 文件，暂不读取图片、PDF、压缩包。");
                    fileName = fileName.replace('/', '_').replace('\\', '_');
                    String mime = getContentResolver().getType(uri);
                    if (mime != null && !Arrays.asList("text/plain", "text/markdown", "text/x-markdown", "application/json", "text/json", "application/octet-stream").contains(mime.toLowerCase(Locale.ROOT).split(";")[0])) throw new IOException("来源文件类型不支持，请分享纯文本对话文件。");
                    content = ShareStore.utf8(ShareStore.readBounded(getContentResolver().openInputStream(uri), ShareStore.FILE_LIMIT));
                    if (title.isEmpty()) title = fileName;
                } else {
                    CharSequence extra = received.getCharSequenceExtra(Intent.EXTRA_TEXT);
                    content = extra == null ? "" : extra.toString();
                    if (content.isEmpty() && received.getClipData() != null && received.getClipData().getItemCount() == 1) {
                        CharSequence clipText = received.getClipData().getItemAt(0).getText(); if (clipText != null) content = clipText.toString();
                    }
                    content = ShareStore.utf8(content.getBytes(StandardCharsets.UTF_8));
                }
                store.add(content, title, fileName); outcome = "分享内容已保存在本机。点击“导入这份内容”后，先检查，再生成知识图谱。";
            } catch (Exception error) { outcome = error instanceof IOException ? error.getMessage() : "无法读取这份分享，请从来源 App 重新分享文字或对话文件。"; }
            final String message = outcome;
            main.post(() -> {
                receiveCount = Math.max(0, receiveCount - 1); receiving = receiveCount > 0;
                if (receiveToken.equals(currentReceiveToken)) setIntent(new Intent(this, MainActivity.class));
                banner = message; showHome();
            });
        });
    }
    private boolean internal(String value) {
        try {
            URI uri = new URI(value); URI root = new URI(workspace);
            int port = uri.getPort() == -1 ? 443 : uri.getPort(), rootPort = root.getPort() == -1 ? 443 : root.getPort();
            return "https".equalsIgnoreCase(uri.getScheme()) && root.getHost().equalsIgnoreCase(uri.getHost()) && uri.getUserInfo() == null && port == rootPort;
        } catch (Exception error) { return false; }
    }
    private boolean isInbox(String value) { return internal(value) && "/mobile-inbox.html".equals(Uri.parse(value).getPath()); }
    private void openWorkspace(String importId) {
        if (workspace.isEmpty()) { alert("请先保存 HTTPS 工作区地址。"); return; }
        destroyWeb(); handoffId = importId; handoffNonce = ""; handoffRunning = false;
        LinearLayout body = column(); body.setBackgroundColor(PAPER); applyInsets(body);
        LinearLayout bar = new LinearLayout(this);
        bar.addView(button("‹ 本机收件箱", this::showHome), new LinearLayout.LayoutParams(0, dp(50), 1));
        bar.addView(button("重新载入", () -> { if (web != null) web.reload(); }), new LinearLayout.LayoutParams(0, dp(50), 1));
        body.addView(bar); body.addView(text(importId.isEmpty() ? "ChatGraph 工作区" : "正在导入；成功存入网页收件箱后才会删除本机副本。", 12));
        web = new WebView(this); body.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(body);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false); settings.setMediaPlaybackRequiresUserGesture(true); settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                // Reload or navigation cancels the old page's asynchronous receipt.
                if (view == web) { handoffRunning = false; handoffNonce = ""; }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String target = request.getUrl().toString();
                if (internal(target)) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(request.getUrl().getScheme())) external(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("https".equals(scheme) && internal(request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (isInbox(url) && view == web && isInbox(view.getUrl()) && !handoffId.isEmpty() && !handoffRunning) transfer();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { handoffRunning = false; handoffNonce = ""; banner = "工作区暂时无法连接，本机内容仍保留。请检查地址、网络和服务状态。"; Toast.makeText(MainActivity.this, banner, Toast.LENGTH_LONG).show(); }
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); alert("工作区 HTTPS 证书无效，连接已停止。请修复证书后重试。"); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!internal(view.getUrl())) return false;
                if (chooser != null) chooser.onReceiveValue(null); chooser = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT); pick.addCategory(Intent.CATEGORY_OPENABLE); pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/markdown", "application/json", "application/octet-stream"});
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                try { startActivityForResult(pick, PICK_FILE); } catch (ActivityNotFoundException error) { chooser.onReceiveValue(null); chooser = null; alert("未找到文件选择器。"); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        web.setDownloadListener((url, agent, disposition, mime, size) -> {
            if (internal(url)) confirm("在浏览器下载", "下载将交给系统浏览器；浏览器可能要求重新登录。", () -> external(Uri.parse(url)));
            else alert("此导出使用浏览器内存文件。请在系统浏览器中打开工作区后导出，App 暂不直接保存 Blob 文件。");
        });
        web.loadUrl(workspace + "/mobile-inbox.html");
    }
    private void transfer() {
        if (web == null || !isInbox(web.getUrl()) || handoffId.isEmpty() || handoffRunning) return;
        handoffRunning = true;
        final String itemId = handoffId, nonce = UUID.randomUUID().toString(); handoffNonce = nonce;
        worker.execute(() -> {
            try {
                JSONObject payload = store.read(itemId);
                String source = "(()=>{const key=" + JSONObject.quote(nonce) + ";const receipt=" + JSONObject.quote("chatgraph:native-android:" + itemId) + ";window.__chatgraphNativeAck={key,state:'pending'};(async()=>{try{const m=await import('/mobile.js');let r=null;const old=localStorage.getItem(receipt);if(old)r=await m.readMobileShare(old);if(!r){r=await m.saveMobileShare(" + payload.toString() + ");localStorage.setItem(receipt,r.id);}window.__chatgraphNativeAck={key,state:'saved',id:r.id};}catch(e){window.__chatgraphNativeAck={key,state:'error',message:e.message||'无法保存到网页收件箱'};}})();return 'started';})()";
                main.post(() -> {
                    if (!liveTransfer(nonce)) return;
                    web.evaluateJavascript(source, ignored -> poll(nonce, itemId, 0));
                });
            } catch (Exception error) { main.post(() -> failTransfer(nonce, "读取本机内容失败，副本仍保留，请重试。")); }
        });
    }
    private boolean liveTransfer(String nonce) { return web != null && !isDestroyed() && handoffRunning && nonce.equals(handoffNonce) && isInbox(web.getUrl()); }
    private void poll(String nonce, String itemId, int attempts) {
        if (!liveTransfer(nonce)) return;
        if (attempts >= 120) { failTransfer(nonce, "网页保存等待超时。本机副本仍保留，稍后重新导入即可。"); return; }
        web.evaluateJavascript("JSON.stringify(window.__chatgraphNativeAck||{})", result -> {
            if (!liveTransfer(nonce)) return;
            try {
                Object decoded = new JSONTokener(result).nextValue();
                JSONObject ack = decoded instanceof String ? new JSONObject((String) decoded) : new JSONObject();
                if (nonce.equals(ack.optString("key")) && "saved".equals(ack.optString("state")) && ack.optString("id").matches("[a-f0-9-]{36}")) {
                    store.remove(itemId); handoffId = ""; handoffRunning = false; handoffNonce = "";
                    Toast.makeText(this, "已存入工作区的手机收件箱，请检查并继续整理。", Toast.LENGTH_LONG).show();
                    // The inbox reads its fragment at startup. A distinct, content-free URL
                    // forces a new document instead of only changing the existing fragment.
                    web.loadUrl(workspace + "/mobile-inbox.html?native=" + nonce + "#" + ack.getString("id"));
                    return;
                }
                if (nonce.equals(ack.optString("key")) && "error".equals(ack.optString("state"))) { failTransfer(nonce, ack.optString("message") + "。本机副本仍保留。"); return; }
            } catch (Exception error) { failTransfer(nonce, "无法确认网页保存结果。本机副本仍保留。"); return; }
            main.postDelayed(() -> poll(nonce, itemId, attempts + 1), 500);
        });
    }
    private void failTransfer(String nonce, String message) {
        if (!nonce.equals(handoffNonce)) return; handoffRunning = false; handoffNonce = ""; alert(message);
    }
    private void external(Uri uri) {
        if (!"https".equals(uri.getScheme()) || uri.getEncodedAuthority() == null || uri.getEncodedAuthority().contains("@")) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { alert("未找到可打开链接的浏览器。"); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && chooser != null) {
            Uri value = result == RESULT_OK && data != null ? data.getData() : null;
            chooser.onReceiveValue(value != null && "content".equals(value.getScheme()) ? new Uri[]{value} : null); chooser = null;
        }
    }
    private void alert(String message) { if (!isFinishing() && !isDestroyed()) new AlertDialog.Builder(this).setTitle("ChatGraph").setMessage(message).setPositiveButton("知道了", null).show(); }
    private void confirm(String title, String message, Runnable action) { new AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton("取消", null).setPositiveButton("继续", (dialog, which) -> action.run()).show(); }
    private void destroyWeb() {
        if (chooser != null) { chooser.onReceiveValue(null); chooser = null; }
        if (web != null) { web.stopLoading(); web.setWebChromeClient(null); web.setWebViewClient(new WebViewClient()); web.destroy(); web = null; }
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else if (web != null) showHome(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle outState) { outState.putBoolean("share_consumed", !receiving); super.onSaveInstanceState(outState); }
    @Override protected void onDestroy() { handoffNonce = ""; destroyWeb(); worker.shutdown(); super.onDestroy(); }
}
