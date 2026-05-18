package org.dromara.neutrinoproxy.client.config;

import cn.hutool.core.util.StrUtil;
import io.netty.channel.WriteBufferWaterMark;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.client.util.StringUtil;
import org.noear.solon.annotation.Component;
import org.noear.solon.annotation.Inject;

/**
 *
 * @author: aoshiguchen
 * @date: 2022/6/16
 */
@Slf4j
@Data
@Component
public class ProxyConfig {
	@Inject("${neutrino.proxy.protocol}")
	private Protocol protocol;
	@Inject("${neutrino.proxy.tunnel}")
	private Tunnel tunnel;
	@Inject("${neutrino.proxy.client}")
	private Client client;

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
	public static class Tunnel {
		private String keyStorePassword;
		private String jksPath;
		private String serverIp;
		private Integer serverPort;
		private Boolean sslEnable;
		private Integer obtainLicenseInterval;
		private String licenseKey;
		private Integer threadCount;
		private String clientId;
		private Boolean transferLogEnable;
		private Boolean heartbeatLogEnable;
		private Reconnection reconnection;
	}

	@Data
	public static class Client {
//		private Tcp tcp;
		private Udp udp;
	}

	@Data
	public static class Reconnection {
		private Integer intervalSeconds;
		private Boolean unlimited;
	}

	@Data
	public static class Tcp {

	}

	@Data
	public static class Udp {
		private Integer bossThreadCount;
		private Integer workThreadCount;
		private String puppetPortRange;
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
