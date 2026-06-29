# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# workflow
- When debugging issues, add debug logs first before making changes or hypothesizing root causes. Confidence: 0.80
- Do not modify existing Rust type definitions or serde annotations (especially #[serde(deserialize_with)]) in types that generate TypeScript bindings via specta — changing them alters the generated bind.ts types and breaks existing frontend code. Only add new types/commands, leave pre-existing type annotations unchanged. Confidence: 0.90

# architecture
- Use the existing UserData service for persisting download state rather than a separate storage mechanism. Confidence: 0.60
