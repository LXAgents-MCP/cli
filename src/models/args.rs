//! Reading tool arguments that are not paths or command lines.
//!
//! A wrong type is a refusal naming the argument. The 4.x SDK checked the input schema before a
//! handler ran; rmcp does not for a hand-written tool, so each handler checks here.
use serde_json::Value;

use crate::config::settings::MAX_TIMEOUT;
use crate::models::tool::ToolArgs;
use crate::utils::errors::ToolError;

/// The largest integer a JSON number carries exactly, as the 4.x schemas bounded it.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The JavaScript name of a JSON value's type, as the refusals have always named it.
pub fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// An argument that is absent or `null`, as `None`.
fn present<'a>(args: &'a ToolArgs, name: &str) -> Option<&'a Value> {
    args.get(name).filter(|value| !value.is_null())
}

/// An optional boolean argument.
pub fn optional_bool(args: &ToolArgs, name: &str) -> Result<Option<bool>, ToolError> {
    match present(args, name) {
        None => Ok(None),
        Some(Value::Bool(flag)) => Ok(Some(*flag)),
        Some(other) => Err(ToolError::refused(format!(
            "`{name}` must be a boolean, got {}.",
            type_name(other)
        ))),
    }
}

/// An optional number argument.
pub fn optional_number(args: &ToolArgs, name: &str) -> Result<Option<f64>, ToolError> {
    match present(args, name) {
        None => Ok(None),
        Some(Value::Number(number)) => Ok(number.as_f64()),
        Some(other) => Err(ToolError::refused(format!(
            "`{name}` must be a number, got {}.",
            type_name(other)
        ))),
    }
}

/// An optional integer argument. `5.0` is an integer, as it is in JSON Schema.
pub fn optional_integer(args: &ToolArgs, name: &str) -> Result<Option<i64>, ToolError> {
    match present(args, name) {
        None => Ok(None),
        Some(value) => match value.as_f64() {
            Some(number) if number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER => {
                Ok(Some(number as i64))
            }
            _ => Err(ToolError::refused(format!(
                "`{name}` must be an integer, got {value}."
            ))),
        },
    }
}

/// Seconds to wait, clamped to what the server permits.
pub fn clamp_timeout(value: Option<f64>, default_timeout: f64) -> f64 {
    match value {
        Some(requested) if requested.is_finite() => requested.clamp(1.0, MAX_TIMEOUT),
        _ => default_timeout,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn args(value: Value) -> ToolArgs {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn clamps_the_timeout() {
        assert_eq!(clamp_timeout(None, 30.0), 30.0);
        assert_eq!(clamp_timeout(Some(f64::NAN), 7.0), 7.0);
        assert_eq!(clamp_timeout(Some(0.2), 30.0), 1.0);
        assert_eq!(clamp_timeout(Some(5.5), 30.0), 5.5);
        assert_eq!(clamp_timeout(Some(10_000.0), 30.0), MAX_TIMEOUT);
    }

    #[test]
    fn reads_typed_arguments_and_refuses_the_wrong_type() {
        let given = args(json!({"b": true, "n": 2.5, "i": 4.0, "s": "x", "z": null}));
        assert_eq!(optional_bool(&given, "b").unwrap(), Some(true));
        assert_eq!(optional_bool(&given, "missing").unwrap(), None);
        assert_eq!(optional_bool(&given, "z").unwrap(), None);
        assert_eq!(optional_number(&given, "n").unwrap(), Some(2.5));
        assert_eq!(optional_integer(&given, "i").unwrap(), Some(4));

        assert_eq!(
            optional_bool(&given, "s").unwrap_err(),
            ToolError::refused("`s` must be a boolean, got string.")
        );
        assert_eq!(
            optional_number(&given, "s").unwrap_err(),
            ToolError::refused("`s` must be a number, got string.")
        );
        assert_eq!(
            optional_integer(&given, "n").unwrap_err(),
            ToolError::refused("`n` must be an integer, got 2.5.")
        );
    }
}
