use bytes::BytesMut;
use neutrino_client_core::{
    config::{validate, ClientConfig},
    protocol::{Codec, Frame},
};
use tokio_util::codec::{Decoder, Encoder};

#[test]
fn auth_matches_java_wire_format() {
    let mut bytes = BytesMut::new();
    Codec
        .encode(
            Frame {
                kind: 2,
                serial: 0,
                info: "k,id".into(),
                data: vec![],
            },
            &mut bytes,
        )
        .unwrap();
    assert_eq!(
        &bytes[..],
        &[0, 0, 0, 17, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, b'k', b',', b'i', b'd']
    );
}
#[test]
fn handles_fragmented_unicode_and_binary_data() {
    let expected = Frame {
        kind: 5,
        serial: 42,
        info: "访客".into(),
        data: vec![0, 255, 3],
    };
    let mut bytes = BytesMut::new();
    Codec.encode(expected, &mut bytes).unwrap();
    let mut fragment = bytes.split_to(8);
    assert!(Codec.decode(&mut fragment).unwrap().is_none());
    fragment.extend_from_slice(&bytes);
    let decoded = Codec
        .decode(&mut fragment)
        .unwrap()
        .expect("complete frame");
    assert_eq!(decoded.info, "访客");
    assert_eq!(decoded.data, vec![0, 255, 3]);
}
#[test]
fn rejects_oversized_frames_before_allocating() {
    let mut bytes = BytesMut::from(&[127, 255, 255, 255][..]);
    assert!(Codec.decode(&mut bytes).is_err());
}
#[test]
fn rejects_invalid_info_length() {
    let mut bytes =
        BytesMut::from(&[0, 0, 0, 13, 2, 0, 0, 0, 0, 0, 0, 0, 0, 127, 255, 255, 255][..]);
    assert!(Codec.decode(&mut bytes).is_err());
}
#[test]
fn validation_reports_all_actionable_fields() {
    let config = ClientConfig {
        server: "https://bad/path".into(),
        port: 0,
        reconnect_seconds: 0,
        udp_port_range: "12000-10000".into(),
        ..Default::default()
    };
    let errors = validate(&config, false);
    for field in [
        "server",
        "port",
        "license",
        "reconnectSeconds",
        "udpPortRange",
    ] {
        assert!(errors.contains_key(field), "missing {field}");
    }
}

#[test]
fn built_in_jks_loads_without_java_runtime() {
    let roots = neutrino_client_core::transport::trust_roots(
        &ClientConfig::default(),
        &neutrino_client_core::config::Secrets::default(),
    )
    .unwrap();
    assert!(!roots.is_empty());
}

#[test]
fn a_short_license_is_never_fully_exposed_by_its_hint() {
    assert_eq!(neutrino_client_core::config::license_hint("abc"), "••••");
}
