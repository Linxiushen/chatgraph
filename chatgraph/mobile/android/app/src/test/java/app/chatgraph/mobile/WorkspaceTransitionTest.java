package app.chatgraph.mobile;

import org.junit.Test;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public final class WorkspaceTransitionTest {
    @Test public void switchAndForgetCannotMutateSelectionWhileCookieCleanupIsPending() {
        WorkspaceTransition state = new WorkspaceTransition();
        AtomicReference<String> saved = new AtomicReference<>("workspace A");
        AtomicBoolean defaultDisabled = new AtomicBoolean(false);
        long change = state.begin(() -> {});
        assertTrue(state.isActive());
        assertEquals(0, state.begin(() -> { saved.set(""); defaultDisabled.set(true); }));
        assertEquals(0, state.begin(() -> saved.set("workspace C")));
        assertEquals("workspace A", saved.get());
        assertFalse(defaultDisabled.get());
        assertTrue(state.complete(change, () -> saved.set("workspace B")));
        assertEquals("workspace B", saved.get());
        assertFalse(state.isActive());
    }

    @Test public void lateSwitchCallbackCannotUndoALaterForgetOrReopenItsWorkspace() {
        WorkspaceTransition state = new WorkspaceTransition();
        AtomicReference<String> saved = new AtomicReference<>("workspace A");
        AtomicBoolean defaultDisabled = new AtomicBoolean(false), opened = new AtomicBoolean(false);
        long change = state.begin(() -> {});
        state.cancel(); // Activity teardown invalidates the old asynchronous work.
        long forget = state.begin(() -> { saved.set(""); defaultDisabled.set(true); });
        assertFalse(state.complete(change, () -> { saved.set("workspace B"); opened.set(true); }));
        assertTrue(state.isActive());
        assertTrue(state.complete(forget, () -> {}));
        assertEquals("", saved.get());
        assertTrue(defaultDisabled.get());
        assertFalse(opened.get());
        assertEquals("", WorkspaceConfiguration.resolve(null, defaultDisabled.get(), "https://provided.example.com"));
    }

    @Test public void completionIsSingleUseAndCannotCommitAfterTeardown() {
        WorkspaceTransition state = new WorkspaceTransition();
        AtomicReference<String> saved = new AtomicReference<>("workspace A");
        long first = state.begin(() -> {});
        assertTrue(state.complete(first, () -> saved.set("workspace B")));
        assertFalse(state.complete(first, () -> saved.set("unexpected duplicate")));
        long second = state.begin(() -> {});
        state.cancel();
        assertFalse(state.complete(second, () -> saved.set("after teardown")));
        assertEquals("workspace B", saved.get());
        assertFalse(state.isActive());
    }
}
