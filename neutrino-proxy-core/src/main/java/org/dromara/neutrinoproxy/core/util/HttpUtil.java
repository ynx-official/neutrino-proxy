package org.dromara.neutrinoproxy.core.util;


import org.apache.commons.lang3.StringUtils;

/**
 * @author: wen.y
 * @date: 2023/12/9
 */
public class HttpUtil {

    /**
     * 获取请求头 Host 忽略端口号
     * @param httpContent
     * @return
     */
    public static String getHostIgnorePort(String httpContent) {
        String host = getHost(httpContent);
        if (StringUtils.isEmpty(host) || !host.contains(":")) {
            return host;
        }
        return host.replaceAll(":.*", "");
    }

    /**
     * 获取请求头 Host
     * @param httpContent
     * @return
     */
    public static String getHost(String httpContent) {
        return getHeaderValue(httpContent, "Host");
    }

    /**
     * 获取请求头
     * @param httpContent
     * @return
     */
    public static String getHeaderValue(String httpContent, String header) {
        if (!httpContent.contains("\r\n\r\n")) {
            return null;
        }
        String headerContent = httpContent.split("\r\n\r\n")[0];
        if (!headerContent.contains("\r\n")) {
            return null;
        }
        String[] lines = headerContent.split("\r\n");
        if (lines.length == 0) {
            return null;
        }
        String firstLine = lines[0];
        if (!(firstLine.endsWith("HTTP/1.1") || firstLine.endsWith("HTTP/1.0"))) {
            return null;
        }
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (!line.startsWith(header + ":")) {
                continue;
            }
            if (line.length() > header.length() + 1) {
                return line.substring(header.length() + 1).trim();
            } else {
                return "";
            }
        }
        return null;
    }

}
