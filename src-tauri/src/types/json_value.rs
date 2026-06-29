use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::datatype::DataType;
use specta::{Type, Types};

/// A JSON value wrapper that serializes natively via serde but maps to `any`
/// in TypeScript, avoiding specta's infinite recursion with `serde_json::Value`.
///
/// Use this in command signatures where you want to pass/receive arbitrary
/// JSON without causing specta to stack overflow during type generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JsonValue(pub Value);

impl Type for JsonValue {
    fn definition(_types: &mut Types) -> DataType {
        DataType::Reference(specta_typescript::define("any"))
    }
}
