package org.dromara.neutrinoproxy.server.controller.res.stats;

import lombok.Data;
import lombok.experimental.Accessors;

/**
 *
 * @author: wen.y
 * @date: 2026/1/20
 */
@Accessors(chain = true)
@Data
public class StatsInfoRes {
    private CacheInfo cacheInfo;

    @Data
    public static class CacheInfo {
        private Integer proxyInfoMapSize;
        private Integer serverPortToCmdChannelMapSize;
        private Integer licenseToCmdChannelMapSize;
        private Integer serverPortToVisitorChannelMapSize;
        private Integer proxyConnectAttachmentMapSize;
        private Integer fullDomainToServerPortMapSize;
        private Integer domainToDomainNameIdMapSize;
        private Integer licenseIdToClientIdMapSize;
        private Integer visitorIdToSocketAddressMapSize;
        private Integer socketAddressToVisitorIdMapSize;
        private Integer visitorIdToTunnelChannelMapSize;
    }

}
