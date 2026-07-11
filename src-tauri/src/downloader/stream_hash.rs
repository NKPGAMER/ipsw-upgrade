use md5::Md5;
use sha1::Sha1;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HashAlgo {
    Md5,
    Sha1,
    Sha256,
}

impl HashAlgo {
    pub fn as_str(&self) -> &'static str {
        match self {
            HashAlgo::Md5 => "md5",
            HashAlgo::Sha1 => "sha1",
            HashAlgo::Sha256 => "sha256",
        }
    }
}

enum Inner {
    Md5(Md5),
    Sha1(Sha1),
    Sha256(Sha256),
}

pub struct StreamHasher {
    inner: Inner,
    algo: HashAlgo,
    bytes_hashed: u64,
    finalized: bool,
}

impl StreamHasher {
    pub fn new(algo: HashAlgo) -> Self {
        let inner = match algo {
            HashAlgo::Md5 => Inner::Md5(Md5::new()),
            HashAlgo::Sha1 => Inner::Sha1(Sha1::new()),
            HashAlgo::Sha256 => Inner::Sha256(Sha256::new()),
        };
        Self {
            inner,
            algo,
            bytes_hashed: 0,
            finalized: false,
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        if self.finalized {
            return;
        }
        match &mut self.inner {
            Inner::Md5(h) => Digest::update(h, data),
            Inner::Sha1(h) => Digest::update(h, data),
            Inner::Sha256(h) => Digest::update(h, data),
        }
        self.bytes_hashed += data.len() as u64;
    }

    pub fn finalize(mut self) -> String {
        self.finalized = true;
        match self.inner {
            Inner::Md5(h) => hex_encode(h.finalize()),
            Inner::Sha1(h) => hex_encode(h.finalize()),
            Inner::Sha256(h) => hex_encode(h.finalize()),
        }
    }

    pub fn bytes_hashed(&self) -> u64 {
        self.bytes_hashed
    }

    pub fn algo(&self) -> HashAlgo {
        self.algo
    }
}

fn hex_encode(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
