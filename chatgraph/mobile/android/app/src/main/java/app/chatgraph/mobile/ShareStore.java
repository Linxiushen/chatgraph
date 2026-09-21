package app.chatgraph.mobile;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Small, application-private queue. Never writes a share to shared storage or backup. */
final class ShareStore {
    static final int TEXT_LIMIT = 2 * 1024 * 1024;
    static final int FILE_LIMIT = 25 * 1024 * 1024;
    // Android may create more than one Activity/ShareStore in the same process.
    private static final Object LOCK = new Object();
    private final File directory;
    ShareStore(Context context) { this(new File(context.getNoBackupFilesDir(), "inbox")); }
    ShareStore(File directory) { this.directory = directory; }

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
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                if (c < 32 && c != '\t' && c != '\n' && c != '\r') throw new IOException("请选择 UTF-8 编码的对话文本，暂不支持二进制文件。");
            }
            return value;
        } catch (CharacterCodingException error) { throw new IOException("文件不是有效的 UTF-8 文本，请转换编码后重新分享。"); }
    }
    private File path(String id, String suffix) throws IOException {
        if (id == null || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) throw new IOException("收件标识无效。");
        return new File(directory, id + suffix);
    }
    private void prepareDirectory() throws IOException {
        Files.createDirectories(directory.toPath());
        File[] unfinished = directory.listFiles((dir, name) -> name.matches("[a-f0-9-]{36}\\.(json|meta)\\.pending-[a-f0-9-]{36}"));
        // The process lock excludes active writers. These are writes that never
        // reached their atomic commit, so they must not accumulate after a crash.
        if (unfinished != null) for (File file : unfinished) Files.deleteIfExists(file.toPath());
    }
    private static void write(File file, JSONObject value) throws IOException {
        Path pending = file.toPath().resolveSibling(file.getName() + ".pending-" + UUID.randomUUID());
        try {
            try (FileOutputStream stream = new FileOutputStream(pending.toFile())) {
                stream.write(value.toString().getBytes(StandardCharsets.UTF_8)); stream.getFD().sync();
            }
            Files.move(pending, file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(pending); }
    }
    private static JSONObject readJson(File file, int limit) throws Exception {
        // Upgrade recovery for receipts written by Android AtomicFile in 0.4.1.
        File backup = new File(file + ".bak");
        if (backup.exists()) Files.move(backup.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
        return new JSONObject(utf8(readBounded(new FileInputStream(file), limit)));
    }
    private static String fingerprint(JSONObject payload) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (String key : Arrays.asList("text", "title", "fileName")) {
            byte[] value = payload.getString(key).getBytes(StandardCharsets.UTF_8);
            digest.update(ByteBuffer.allocate(4).putInt(value.length).array()); digest.update(value);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    private static void validate(JSONObject payload) throws Exception {
        String text = payload.getString("text"), title = payload.getString("title"), fileName = payload.getString("fileName");
        int bytes = text.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > (fileName.isEmpty() ? TEXT_LIMIT : FILE_LIMIT) || title.getBytes(StandardCharsets.UTF_8).length > 4096 || fileName.getBytes(StandardCharsets.UTF_8).length > 1024) throw new IOException("内容超过允许大小。");
        if (text.trim().isEmpty()) throw new IOException("没有收到文字。请复制对话原文或分享 TXT、Markdown、JSON 文件。");
        if (!fileName.isEmpty() && !fileName.matches("(?i).+\\.(txt|md|markdown|json)")) throw new IOException("请选择 TXT、Markdown 或 JSON 文件。");
        utf8(text.getBytes(StandardCharsets.UTF_8));
    }
    private JSONObject metadata(String id, JSONObject payload, long createdAt) throws Exception {
        validate(payload);
        return new JSONObject().put("id", id).put("title", payload.getString("title")).put("fileName", payload.getString("fileName"))
            .put("bytes", payload.getString("text").getBytes(StandardCharsets.UTF_8).length).put("createdAt", createdAt).put("digest", fingerprint(payload));
    }
    private List<JSONObject> listLocked() throws IOException {
        prepareDirectory();
        List<JSONObject> result = new ArrayList<>();
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json") || name.endsWith(".json.bak"));
        if (files == null) throw new IOException("暂时无法读取本机收件箱；原文未删除，请重试。");
        Set<String> seen = new HashSet<>();
        for (File file : files) {
            String name = file.getName().replaceFirst("\\.bak$", "");
            String id = name.substring(0, name.length() - 5);
            if (!seen.add(id)) continue;
            try {
                File payloadFile = path(id, ".json"), metaFile = path(id, ".meta");
                JSONObject item;
                try {
                    item = readJson(metaFile, 32768);
                    if (!id.equals(item.getString("id")) || item.getLong("bytes") < 0 || item.getLong("bytes") > FILE_LIMIT) throw new IOException("Invalid receipt metadata");
                } catch (Exception unreadableMetadata) {
                    // A process can stop after the durable original is written but
                    // before metadata commits. Rebuild it instead of hiding the share.
                    item = metadata(id, readJson(payloadFile, FILE_LIMIT * 2 + 32768), payloadFile.lastModified());
                    write(metaFile, item);
                }
                result.add(item);
            } catch (Exception error) { throw new IOException("本机收件内容暂时无法读取，已保留原件；请重试或明确清空收件箱。", error); }
        }
        result.sort(Comparator.comparingLong(item -> item.optLong("createdAt")));
        return result;
    }
    List<JSONObject> list() throws IOException { synchronized (LOCK) { return listLocked(); } }
    void add(String text, String title, String fileName) throws Exception {
        synchronized (LOCK) {
            JSONObject payload = new JSONObject().put("text", text).put("title", title).put("fileName", fileName);
            validate(payload);
            String digest = fingerprint(payload);
            List<JSONObject> items = listLocked();
            long existing = 0;
            for (JSONObject item : items) {
                String previousDigest = item.optString("digest");
                if (previousDigest.isEmpty()) previousDigest = fingerprint(readJson(path(item.getString("id"), ".json"), FILE_LIMIT * 2 + 32768));
                if (digest.equals(previousDigest)) {
                    if (!digest.equals(fingerprint(readJson(path(item.getString("id"), ".json"), FILE_LIMIT * 2 + 32768)))) throw new IOException("已有收件原文无法确认，请先检查本机收件箱。");
                    return; // Replayed Android share still durably in the queue.
                }
                existing += item.optLong("bytes");
            }
            int bytes = text.getBytes(StandardCharsets.UTF_8).length;
            if (items.size() >= 5 || existing + bytes > 50L * 1024 * 1024) throw new IOException("本机收件箱已满（最多 5 份、合计 50 MB）。请先导入或清除已有内容。");
            String id = UUID.randomUUID().toString();
            write(path(id, ".json"), payload);
            write(path(id, ".meta"), metadata(id, payload, System.currentTimeMillis()));
        }
    }
    JSONObject read(String id) throws Exception {
        synchronized (LOCK) {
            JSONObject payload = readJson(path(id, ".json"), FILE_LIMIT * 2 + 32768); validate(payload); return payload;
        }
    }
    void remove(String id) throws IOException {
        synchronized (LOCK) {
            // Retire recovery copies before deleting the original.
            for (String suffix : Arrays.asList(".json.bak", ".json.new", ".json", ".meta.bak", ".meta.new", ".meta")) Files.deleteIfExists(path(id, suffix).toPath());
        }
    }
    void clear() throws IOException {
        synchronized (LOCK) {
            File[] files = directory.listFiles(); if (files == null) return;
            for (File file : files) Files.deleteIfExists(file.toPath());
        }
    }
}
