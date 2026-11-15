//! Command-line options, parsed without side effects. `main` applies them to a [`Config`], so
//! this module reads nothing and depends on nothing above it.
//!
//! The rules are those of Node's `util.parseArgs` in strict mode, which the 4.x server used:
//! `--name value` or `--name=value`, the last occurrence wins, an unknown option, a missing value
//! or a positional argument is an error. A help library is not used because it would print
//! `--help` to stdout, which is the protocol channel.
//!
//! [`Config`]: super::settings::Config
use std::fmt;

pub const USAGE: &str = "Host CLI MCP Server

Usage: lxagents-cli [options]

Options:
  --confine DIR     Refuse to act outside this directory
  --allow CMD,...   Comma-separated executables allowed to run
  --timeout SEC     Default command timeout in seconds (30 if unset)
  -h, --help        Show this help
";

/// A bad command line. The message is for the person who typed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageError(pub String);

impl fmt::Display for UsageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UsageError {}

/// What the command line asked for. A flag that was not passed is `None`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Options {
    pub confine: Option<String>,
    pub allow: Option<Vec<String>>,
    pub timeout: Option<f64>,
    pub help: bool,
}

/// The options that take a value.
const VALUE_OPTIONS: [&str; 3] = ["confine", "allow", "timeout"];

/// Parse the arguments after the program name.
pub fn parse_options<S: AsRef<str>>(argv: &[S]) -> Result<Options, UsageError> {
    let mut confine: Option<String> = None;
    let mut allow: Option<String> = None;
    let mut timeout: Option<String> = None;
    let mut help = false;

    let mut index = 0;
    while index < argv.len() {
        let arg = argv[index].as_ref();
        index += 1;

        if arg == "--" {
            if let Some(next) = argv.get(index) {
                return Err(positional(next.as_ref()));
            }
            break;
        }

        if arg == "-h" || arg == "--help" {
            help = true;
            continue;
        }

        if let Some(long) = arg.strip_prefix("--") {
            let (name, inline) = match long.split_once('=') {
                Some((name, value)) => (name, Some(value.to_string())),
                None => (long, None),
            };

            if name == "help" {
                return Err(UsageError(
                    "Option '-h, --help' does not take an argument".to_string(),
                ));
            }
            if !VALUE_OPTIONS.contains(&name) {
                return Err(UsageError(format!(
                    "Unknown option '--{name}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--{name}\""
                )));
            }

            let value = match inline {
                Some(value) => value,
                None => match argv.get(index).map(AsRef::as_ref) {
                    None => {
                        return Err(UsageError(format!(
                            "Option '--{name} <value>' argument missing"
                        )));
                    }
                    Some(next) if next.starts_with('-') => {
                        return Err(UsageError(format!(
                            "Option '--{name} <value>' argument is ambiguous.\nDid you forget to specify the option argument for '--{name}'?\nTo specify an option argument starting with a dash use '--{name}=-XYZ'."
                        )));
                    }
                    Some(next) => {
                        index += 1;
                        next.to_string()
                    }
                },
            };

            match name {
                "confine" => confine = Some(value),
                "allow" => allow = Some(value),
                _ => timeout = Some(value),
            }
            continue;
        }

        if arg.starts_with('-') && arg.len() > 1 {
            return Err(UsageError(format!(
                "Unknown option '{arg}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{arg}\""
            )));
        }

        return Err(positional(arg));
    }

    let mut options = Options {
        help,
        ..Options::default()
    };

    // An empty value is the same as not passing the flag, as it was in 4.x.
    options.confine = confine.filter(|dir| !dir.is_empty());

    options.allow = allow.filter(|list| !list.is_empty()).map(|list| {
        list.split(',')
            .map(|name| name.trim().to_lowercase())
            .filter(|name| !name.is_empty())
            .collect()
    });

    if let Some(raw) = timeout {
        let seconds = raw.trim().parse::<f64>().unwrap_or(f64::NAN);
        // An empty string reads as zero in 4.x, which is refused below either way.
        if !seconds.is_finite() || seconds <= 0.0 {
            return Err(UsageError(format!(
                "--timeout must be a positive number of seconds, got '{raw}'."
            )));
        }
        options.timeout = Some(seconds);
    }

    Ok(options)
}

fn positional(arg: &str) -> UsageError {
    UsageError(format!(
        "Unexpected argument '{arg}'. This command does not take positional arguments"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Options, UsageError> {
        parse_options(args)
    }

    #[test]
    fn no_flags_is_the_default() {
        assert_eq!(parse(&[]).unwrap(), Options::default());
    }

    #[test]
    fn reads_every_flag_in_both_spellings() {
        let options = parse(&[
            "--confine",
            "/srv",
            "--allow=Git, NPM,,",
            "--timeout",
            "12.5",
        ])
        .unwrap();
        assert_eq!(options.confine.as_deref(), Some("/srv"));
        assert_eq!(
            options.allow,
            Some(vec!["git".to_string(), "npm".to_string()])
        );
        assert_eq!(options.timeout, Some(12.5));
        assert!(!options.help);
    }

    #[test]
    fn the_last_occurrence_wins() {
        let options = parse(&["--timeout", "5", "--timeout=7"]).unwrap();
        assert_eq!(options.timeout, Some(7.0));
    }

    #[test]
    fn help_in_either_form() {
        assert!(parse(&["-h"]).unwrap().help);
        assert!(parse(&["--help"]).unwrap().help);
    }

    #[test]
    fn empty_values_count_as_absent() {
        let options = parse(&["--confine=", "--allow", ""]).unwrap();
        assert_eq!(options.confine, None);
        assert_eq!(options.allow, None);
    }

    #[test]
    fn refuses_a_bad_timeout() {
        for value in ["abc", "0", "-3", "", "inf", "NaN"] {
            let error = parse(&[&format!("--timeout={value}")]).unwrap_err();
            assert!(
                error.0.starts_with("--timeout must be a positive number"),
                "{value}: {error}"
            );
        }
    }

    #[test]
    fn refuses_unknown_options_positionals_and_missing_values() {
        assert!(
            parse(&["--bogus"])
                .unwrap_err()
                .0
                .starts_with("Unknown option '--bogus'")
        );
        assert!(
            parse(&["-x"])
                .unwrap_err()
                .0
                .starts_with("Unknown option '-x'")
        );
        assert!(
            parse(&["stray"])
                .unwrap_err()
                .0
                .starts_with("Unexpected argument 'stray'")
        );
        assert!(
            parse(&["--", "stray"])
                .unwrap_err()
                .0
                .starts_with("Unexpected argument 'stray'")
        );
        assert!(
            parse(&["--confine"])
                .unwrap_err()
                .0
                .contains("argument missing")
        );
        assert!(
            parse(&["--timeout", "--confine", "x"])
                .unwrap_err()
                .0
                .contains("ambiguous")
        );
        assert!(
            parse(&["--help=yes"])
                .unwrap_err()
                .0
                .contains("does not take an argument")
        );
    }
}
