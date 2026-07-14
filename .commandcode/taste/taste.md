# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# Architecture
- For performance-critical native operations (disk I/O, OS syscalls, unbuffered writes), prefer implementing in Rust via the i10r-addon rather than pure Node.js workarounds. Confidence: 0.70

# Communication
- When asked a question about how something works, explain and analyze only — do not modify code unless explicitly asked. Confidence: 0.85
