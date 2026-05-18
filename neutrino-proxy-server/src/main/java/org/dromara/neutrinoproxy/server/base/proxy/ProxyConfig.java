package org.dromara.neutrinoproxy.server.base.proxy;

import cn.hutool.core.util.StrUtil;
import io.netty.channel.WriteBufferWaterMark;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.server.util.StringUtil;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;

/**
 * 服务端代理配置
 * @author: aoshiguchen
 * @date: 2022/6/16
 */
@Slf4j
@Data
@Component
public class ProxyConfig {
	/**
	 * 传输协议相关配置
	 */
	@Inject("${neutrino.proxy.protocol}")
	private Protocol protocol;
	/**
	 * 代理服务配置
	 */
	@Inject("${neutrino.proxy.server}")
	private Server server;
	/**
	 * 代理隧道配置
	 */
	@Inject("${neutrino.proxy.tunnel}")
	private Tunnel tunnel;

	@Data
	public static class Protocol {
		private Integer maxFrameLength;
		private Integer lengthFieldOffset;
		private Integer lengthFieldLength;
		private Integer initialBytesToStrip;
		private Integer lengthAdjustment;
		private Integer readIdleTime;
		private Integer writeIdleTime;
		private Integer allIdleTimeSeconds;
        // 水位线
        private String waterMark;
	}

	@Data
	public static class Server {
		private Tcp tcp;
		private Udp udp;
	}

	@Data
	public static class Tunnel {
		private Integer bossThreadCount;
		private Integer workThreadCount;
		private Integer port;
		private Integer sslPort;
		private String keyStorePassword;
		private String keyManagerPassword;
		private String jksPath;
		private Boolean transferLogEnable;
		private Boolean heartbeatLogEnable;
	}

	@Data
	public static class Tcp {
		private Integer bossThreadCount;
		private Integer workThreadCount;
		private Integer httpProxyPort;
		private Integer httpsProxyPort;
		private String keyStorePassword;
		private String jksPath;
		private Boolean transferLogEnable;
	}

	@Data
	public static class Udp {
		private Integer bossThreadCount;
		private Integer workThreadCount;
		private Boolean transferLogEnable;
	}

    private WriteBufferWaterMark waterMark;
    private boolean isParseWaterMark = false;

    public synchronized WriteBufferWaterMark getWaterMark() {
        if (isParseWaterMark) {
            return waterMark;
        }
        isParseWaterMark = true;
        if (null == protocol || StrUtil.isBlank(protocol.getWaterMark())) {
            return null;
        }
        String[] tmp = protocol.getWaterMark().split("/");
        if (tmp.length != 2) {
            log.info("[配置解析] 水位线配置参数格式有误! config={}", protocol.getWaterMark());
            return null;
        }
        String lowStr = tmp[0].trim();
        String highStr = tmp[1].trim();
        if (!StringUtil.isBytesDesc(lowStr) || !StringUtil.isBytesDesc(highStr)) {
            log.info("[配置解析] 水位线配置参数格式有误! config={}", protocol.getWaterMark());
            return null;
        }
        Long low = StringUtil.parseBytes(lowStr);
        Long high = StringUtil.parseBytes(highStr);
        if (null == low || null == high || low >= high) {
            log.info("[配置解析] 水位线配置参数格式或大小有误! config={}", protocol.getWaterMark());
            return null;
        }
        waterMark = new WriteBufferWaterMark(low.intValue(), high.intValue());
        log.info("[配置解析] 水位线配置 config={},low={},high={}", protocol.getWaterMark(), low.intValue(), high.intValue());
        return waterMark;
    }
}
