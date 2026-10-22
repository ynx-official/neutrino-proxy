use bytes::{Buf, BufMut, BytesMut};
use std::io;
use tokio_util::codec::{Decoder, Encoder};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: u8,
    pub serial: i64,
    pub info: String,
    pub data: Vec<u8>,
}
pub const MAX_FRAME: usize = 2_097_152;
impl Frame {
    pub fn new(kind: u8, info: impl Into<String>, data: Vec<u8>) -> Self {
        Self {
            kind,
            serial: chrono::Utc::now().timestamp_millis(),
            info: info.into(),
            data,
        }
    }
}
#[derive(Default)]
pub struct Codec;
impl Encoder<Frame> for Codec {
    type Error = io::Error;
    fn encode(&mut self, item: Frame, dst: &mut BytesMut) -> io::Result<()> {
        let len = 13usize
            .checked_add(item.info.len())
            .and_then(|n| n.checked_add(item.data.len()))
            .ok_or_else(invalid)?;
        if len + 4 > MAX_FRAME {
            return Err(invalid());
        }
        dst.reserve(len + 4);
        dst.put_u32(len as u32);
        dst.put_u8(item.kind);
        dst.put_i64(item.serial);
        dst.put_u32(item.info.len() as u32);
        dst.extend_from_slice(item.info.as_bytes());
        dst.extend_from_slice(&item.data);
        Ok(())
    }
}
impl Decoder for Codec {
    type Item = Frame;
    type Error = io::Error;
    fn decode(&mut self, src: &mut BytesMut) -> io::Result<Option<Frame>> {
        if src.len() < 4 {
            return Ok(None);
        }
        let len = u32::from_be_bytes(src[..4].try_into().unwrap()) as usize;
        // Validate lengths before reserving or slicing untrusted frame contents.
        if !(13..=MAX_FRAME - 4).contains(&len) {
            return Err(invalid());
        }
        if src.len() < len + 4 {
            return Ok(None);
        }
        let info_len = u32::from_be_bytes(src[13..17].try_into().unwrap()) as usize;
        if info_len > len - 13 {
            return Err(invalid());
        }
        let mut bytes = src.split_to(len + 4);
        bytes.advance(4);
        let kind = bytes.get_u8();
        let serial = bytes.get_i64();
        bytes.advance(4);
        let info = String::from_utf8(bytes.split_to(info_len).to_vec()).map_err(|_| invalid())?;
        Ok(Some(Frame {
            kind,
            serial,
            info,
            data: bytes.to_vec(),
        }))
    }
}
fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "隧道消息格式或长度无效")
}
