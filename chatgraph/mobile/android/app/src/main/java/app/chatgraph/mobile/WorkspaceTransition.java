package app.chatgraph.mobile;

/** Main-thread gate for asynchronous cookie cleanup and the resulting selection. */
final class WorkspaceTransition {
    private long generation;
    private boolean active;

    boolean isActive() { return active; }

    long begin(Runnable accepted) {
        if (active) return 0;
        active = true;
        long ticket = ++generation;
        try { accepted.run(); }
        catch (RuntimeException error) { cancel(); throw error; }
        return ticket;
    }

    boolean complete(long ticket, Runnable commit) {
        if (!active || ticket != generation) return false;
        active = false;
        commit.run();
        return true;
    }

    void cancel() { generation++; active = false; }
}
