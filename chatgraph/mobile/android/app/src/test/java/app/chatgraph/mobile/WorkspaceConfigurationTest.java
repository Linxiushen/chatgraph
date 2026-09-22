package app.chatgraph.mobile;

import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public final class WorkspaceConfigurationTest {
    @Test public void canonicalizesHttpsRootAndExplicitPorts() throws Exception {
        assertEquals("https://graph.example.com", WorkspaceConfiguration.validate(" HTTPS://Graph.Example.com:443/ "));
        assertEquals("https://graph.example.com:8443", WorkspaceConfiguration.validate("https://graph.example.com:8443/"));
        assertEquals("https://[2001:db8::1]", WorkspaceConfiguration.validate("https://[2001:db8::1]/"));
    }

    @Test public void rejectsCredentialsPathsTokensAndInvalidPorts() throws Exception {
        for (String invalid : new String[]{"", "http://graph.example.com", "https://user:secret@graph.example.com", "https://graph.example.com/path",
                "https://graph.example.com/%2f", "https://graph.example.com?token=secret", "https://graph.example.com#token",
                "https://graph.example.com:0", "https://graph.example.com:65536", "https://graph.example.com:",
                "https://localhost", "https://127.0.0.1", "https://[::1]", "https://graph.example.com\n/", "https://bad host"}) {
            try { WorkspaceConfiguration.validate(invalid); fail("Accepted invalid workspace: " + invalid); }
            catch (IOException expected) {}
        }
    }

    @Test public void firstLaunchUsesDefaultWithoutOverridingPriorUserChoice() {
        String bundled = "https://provided.example.com";
        assertEquals(bundled, WorkspaceConfiguration.resolve(null, false, bundled));
        assertEquals("https://mine.example.com", WorkspaceConfiguration.resolve("https://mine.example.com/", false, bundled));
        assertEquals("https://mine.example.com", WorkspaceConfiguration.resolve("https://mine.example.com", true, bundled));
        assertEquals("", WorkspaceConfiguration.resolve(null, true, bundled));
        assertEquals("", WorkspaceConfiguration.resolve("", false, bundled));
        assertEquals("", WorkspaceConfiguration.resolve("bad existing address", false, bundled));
    }

    @Test public void sourceBuildHasNoAssumedServerAndForgetSurvivesNewDefault() {
        assertEquals("", WorkspaceConfiguration.resolve(null, false, ""));
        assertEquals("", WorkspaceConfiguration.resolve(null, false, "https://user:secret@provided.example.com"));
        assertEquals("", WorkspaceConfiguration.resolve(null, true, "https://replacement.example.com"));
    }
}
