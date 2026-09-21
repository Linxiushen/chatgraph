package app.chatgraph.mobile;

import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public final class ShareStoreTest {
    private File directory() throws IOException { return Files.createTempDirectory("chatgraph-share-check-").toFile(); }
    private String id(ShareStore store) throws Exception { return store.list().get(0).getString("id"); }
    private void cleanup(File directory) throws Exception {
        try (java.util.stream.Stream<Path> files = Files.walk(directory.toPath())) {
            for (Path path : (Iterable<Path>) files.sorted(Comparator.reverseOrder())::iterator) Files.deleteIfExists(path);
        }
    }

    @Test public void interruptedMetadataWriteRecoversDurableOriginal() throws Exception {
        File directory = directory();
        try {
            ShareStore first = new ShareStore(directory);
            first.add("用户：保留 Unicode 🧠\nAI：继续", "原文", "对话.md");
            String id = id(first);
            Files.delete(new File(directory, id + ".meta").toPath());
            ShareStore restarted = new ShareStore(directory);
            assertEquals(id, id(restarted));
            assertEquals("原文", restarted.list().get(0).getString("title"));
            assertEquals("用户：保留 Unicode 🧠\nAI：继续", restarted.read(id).getString("text"));
            assertTrue(new File(directory, id + ".meta").isFile());
        } finally { cleanup(directory); }
    }

    @Test public void corruptMetadataRecoversButUnreadableOriginalIsNeverDeleted() throws Exception {
        File directory = directory();
        try {
            ShareStore store = new ShareStore(directory);
            store.add("用户：这份原文不能静默丢失", "恢复", "");
            String id = id(store);
            Path meta = new File(directory, id + ".meta").toPath(), original = new File(directory, id + ".json").toPath();
            Files.write(meta, "broken".getBytes(StandardCharsets.UTF_8));
            assertEquals(id, id(store));
            Files.delete(meta);
            byte[] corrupted = "partial original".getBytes(StandardCharsets.UTF_8);
            Files.write(original, corrupted);
            try { store.list(); fail("An unreadable original must not disappear silently"); } catch (IOException expected) {}
            assertArrayEquals(corrupted, Files.readAllBytes(original));
        } finally { cleanup(directory); }
    }

    @Test public void legacyAtomicBackupsRemainRecoverable() throws Exception {
        File directory = directory();
        try {
            ShareStore store = new ShareStore(directory);
            store.add("旧版本原文", "旧版本", "");
            String id = id(store);
            for (String extension : Arrays.asList(".json", ".meta")) Files.move(new File(directory, id + extension).toPath(), new File(directory, id + extension + ".bak").toPath());
            assertEquals(id, id(new ShareStore(directory)));
            assertEquals("旧版本原文", store.read(id).getString("text"));
            store.remove(id);
            assertTrue(store.list().isEmpty());
        } finally { cleanup(directory); }
    }

    @Test public void intentReplayDoesNotFillQueueWithDuplicateContent() throws Exception {
        File directory = directory();
        try {
            new ShareStore(directory).add("同一个分享", "标题", "");
            for (int index = 0; index < 8; index++) new ShareStore(directory).add("同一个分享", "标题", "");
            assertEquals(1, new ShareStore(directory).list().size());
            new ShareStore(directory).add("同一个分享", "另一次上下文", "");
            assertEquals(2, new ShareStore(directory).list().size());
        } finally { cleanup(directory); }
    }

    @Test public void multipleActivityInstancesShareOneCapacityTransaction() throws Exception {
        File directory = directory();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            AtomicInteger saved = new AtomicInteger();
            CountDownLatch start = new CountDownLatch(1);
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < 12; i++) {
                final int index = i;
                futures.add(pool.submit(() -> {
                    try { start.await(); new ShareStore(directory).add("并发原文 " + index, "", ""); saved.incrementAndGet(); }
                    catch (IOException full) { assertTrue(full.getMessage().contains("已满")); }
                    catch (Exception error) { throw new RuntimeException(error); }
                }));
            }
            start.countDown();
            for (Future<?> future : futures) future.get();
            assertEquals(5, saved.get());
            assertEquals(5, new ShareStore(directory).list().size());
        } finally { pool.shutdownNow(); cleanup(directory); }
    }

    @Test public void validationRejectsBinaryOversizeAndTraversalBeforeWriting() throws Exception {
        File directory = directory();
        try {
            ShareStore store = new ShareStore(directory);
            for (String invalid : Arrays.asList("", "a\u0000b", "x".repeat(ShareStore.TEXT_LIMIT + 1))) {
                try { store.add(invalid, "", ""); fail("Invalid text accepted"); } catch (IOException expected) {}
            }
            try { store.read("../../secret"); fail("Invalid identifier accepted"); } catch (IOException expected) {}
            try { ShareStore.utf8(new byte[]{(byte) 0xff, (byte) 0xfe}); fail("Invalid UTF8 accepted"); } catch (IOException expected) {}
            assertTrue(store.list().isEmpty());
        } finally { cleanup(directory); }
    }

    @Test public void unfinishedAtomicWritesDoNotAccumulateOrBecomeConversations() throws Exception {
        File directory = directory();
        try {
            Path unfinished = new File(directory, UUID.randomUUID() + ".json.pending-" + UUID.randomUUID()).toPath();
            Files.write(unfinished, "incomplete original".getBytes(StandardCharsets.UTF_8));
            assertTrue(new ShareStore(directory).list().isEmpty());
            assertFalse(Files.exists(unfinished));
        } finally { cleanup(directory); }
    }
}
