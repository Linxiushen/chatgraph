package app.chatgraph.mobile;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure configuration rules shared by startup and the editable workspace setting. */
final class WorkspaceConfiguration {
    private WorkspaceConfiguration() {}

    static String validate(String value) throws IOException {
        try {
            String raw = value == null ? "" : value.trim();
            URI uri = new URI(raw);
            String host = uri.getHost();
            if (raw.length() > 2048 || !"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !("".equals(uri.getRawPath()) || "/".equals(uri.getRawPath()))
                    || uri.getPort() == 0 || uri.getPort() > 65535 || uri.getRawAuthority().endsWith(":"))
                throw new URISyntaxException(raw, "Not an HTTPS root");
            host = host.toLowerCase(Locale.ROOT);
            if (host.equals("localhost") || host.equals("localhost.") || host.startsWith("127.")
                    || host.equals("[::1]") || host.equals("[0:0:0:0:0:0:0:1]"))
                throw new IOException("手机的 localhost 是手机自身，请填写手机能访问的 HTTPS 工作区。");
            return new URI("https", null, host, uri.getPort() == 443 ? -1 : uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException error) {
            throw new IOException("请输入完整的 HTTPS 根地址；不要填写路径、密码或访问令牌。");
        }
    }

    // null means never configured; an explicitly empty/invalid saved value must
    // not silently send the user to a different bundled workspace.
    static String resolve(String saved, boolean defaultDisabled, String bundled) {
        String candidate = saved != null ? saved : defaultDisabled ? "" : bundled;
        if (candidate == null || candidate.trim().isEmpty()) return "";
        try { return validate(candidate); } catch (IOException invalid) { return ""; }
    }
}
