package app.chatgraph.mobile;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;

/** Small, application-private queue. Never writes a share to shared storage or backup. */
final class ShareStore {
    static final int TEXT_LIMIT = 2 * 1024 * 1024;
    static final int FILE_LIMIT = 25 * 1024 * 1024;
    private final File directory;
    ShareStore(Context context) { directory = new File(context.getNoBackupFilesDir(), "inbox"); directory.mkdirs(); }

    static byte[] readBounded(InputStream stream, int limit) throws IOException {
        if (stream == null) throw new IOException("无法打开来源文件，请重新分享。");
        try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if ((long) out.size() + count > limit) throw new IOException("内容过大：文字最多 2 MB，单个文件最多 25 MB。");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }
    static String utf8(byte[] bytes) throws IOException {
        try {
            String value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            if (value.startsWith("\uFEFF")) value = value.substring(1);
            if (value.matches("(?s).*[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F].*")) throw new IOException("请选择 UTF-8 编码的对话文本，暂不支持二进制文件。");
            return value;
        } catch (CharacterCodingException error) { throw new IOException("文件不是有效的 UTF-8 文本，请转换编码后重新分享。"); }
    }
    private File path(String id, String suffix) throws IOException {
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("收件标识无效。");
        return new File(directory, id + suffix);
    }
    private static void write(File file, JSONObject value) throws Exception {
        AtomicFile atomic = new AtomicFile(file); FileOutputStream stream = null;
        try { stream = atomic.startWrite(); stream.write(value.toString().getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(stream); }
        catch (Exception error) { if (stream != null) atomic.failWrite(stream); throw error; }
    }
    synchronized List<JSONObject> list() {
        List<JSONObject> result = new ArrayList<>();
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".meta") || name.endsWith(".meta.bak"));
        if (files != null) for (File file : files) {
            try {
                if (file.getName().endsWith(".bak")) file = new File(directory, file.getName().replaceFirst("\\.bak$", ""));
                JSONObject item = new JSONObject(utf8(readBounded(new AtomicFile(file).openRead(), 16384)));
                if (path(item.getString("id"), ".json").exists() && result.stream().noneMatch(previous -> previous.optString("id").equals(item.optString("id")))) result.add(item);
            } catch (Exception ignored) { /* An incomplete metadata write cannot become a conversation. */ }
        }
        result.sort(Comparator.comparingLong(item -> item.optLong("createdAt")));
        return result;
    }
    synchronized void add(String text, String title, String fileName) throws Exception {
        byte[] encoded = text.getBytes(StandardCharsets.UTF_8);
        if (encoded.length > (fileName.isEmpty() ? TEXT_LIMIT : FILE_LIMIT)) throw new IOException("内容超过允许大小。");
        if (text.trim().isEmpty()) throw new IOException("没有收到文字。请复制对话原文或分享 TXT、Markdown、JSON 文件。");
        List<JSONObject> items = list();
        long existing = 0; for (JSONObject item : items) existing += item.optLong("bytes");
        if (items.size() >= 5 || existing + encoded.length > 50L * 1024 * 1024) throw new IOException("本机收件箱已满（最多 5 份、合计 50 MB）。请先导入或清除已有内容。");
        String id = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        JSONObject payload = new JSONObject().put("text", text).put("title", title).put("fileName", fileName);
        JSONObject meta = new JSONObject().put("id", id).put("title", title).put("fileName", fileName).put("bytes", encoded.length).put("createdAt", now);
        write(path(id, ".json"), payload);
        write(path(id, ".meta"), meta);
    }
    synchronized JSONObject read(String id) throws Exception {
        return new JSONObject(utf8(readBounded(new AtomicFile(path(id, ".json")).openRead(), FILE_LIMIT * 2 + 32768)));
    }
    synchronized void remove(String id) throws IOException {
        new AtomicFile(path(id, ".json")).delete(); new AtomicFile(path(id, ".meta")).delete();
    }
    synchronized void clear() {
        File[] files = directory.listFiles(); if (files != null) for (File file : files) file.delete();
    }
}
