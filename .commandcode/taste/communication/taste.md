# Communication
- When asked a question about how something works, explain and analyze only — do not modify code unless explicitly asked. Confidence: 0.85
- When a runtime error surfaces after a refactor, do not dismiss it as pre-existing without thorough investigation — especially if the app was working before the changes. Fix it when asked. Confidence: 0.75
- Fix bugs at the root cause rather than adding defensive null/empty guards downstream. If a value is unexpectedly empty/null, trace back to why it wasn't initialized properly and fix that instead of scattering guards everywhere. Confidence: 0.85
- Do not make assumptions about the current runtime environment (e.g., which backend is live, whether a migration has taken effect) without verification. If the user states the system state, treat that as ground truth; if uncertain, ask before making changes based on an unverified assumption. Confidence: 0.65
- When debugging, do not deflect blame to external dependencies (e.g. native addons, third-party libraries) without concrete evidence. Investigate the integration layer and your own code first — especially when the dependency has been independently tested with clear logs. Confidence: 0.80
- Respond in Vietnamese when the user switches to Vietnamese. Confidence: 0.80
