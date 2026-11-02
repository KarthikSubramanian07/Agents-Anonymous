//! The DSM-A catalog, compiled in from `data/` so the engine and the website
//! share one source of truth.

use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize, Debug, Clone)]
pub struct Disorder {
    pub id: String,
    pub code: String,
    pub name: String,
    pub short: String,
    pub step: u8,
    pub counter: String,
    pub sponsor_note: String,
}

#[derive(Deserialize)]
struct DisorderFile {
    disorders: Vec<Disorder>,
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct ChipCheck {
    pub kind: String,
    #[serde(default)]
    pub min_tool_calls: Option<usize>,
    #[serde(default)]
    pub min_assistant_turns: Option<usize>,
    #[serde(default)]
    pub min_turns: Option<usize>,
    #[serde(default)]
    pub min_score: Option<u32>,
    #[serde(default)]
    pub absent: Vec<String>,
    #[serde(default)]
    pub requires: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Chip {
    pub id: String,
    pub check: ChipCheck,
}

#[derive(Deserialize)]
struct ChipFile {
    chips: Vec<Chip>,
}

pub struct Catalog {
    pub disorders: Vec<Disorder>,
    pub chips: Vec<Chip>,
}

static CATALOG: OnceLock<Catalog> = OnceLock::new();

pub fn catalog() -> &'static Catalog {
    CATALOG.get_or_init(|| {
        let d: DisorderFile = serde_json::from_str(include_str!("../../../data/disorders.json"))
            .expect("data/disorders.json is valid");
        let c: ChipFile = serde_json::from_str(include_str!("../../../data/chips.json"))
            .expect("data/chips.json is valid");
        Catalog { disorders: d.disorders, chips: c.chips }
    })
}

pub fn disorder(id: &str) -> &'static Disorder {
    catalog()
        .disorders
        .iter()
        .find(|d| d.id == id)
        .unwrap_or_else(|| panic!("unknown disorder id {id}"))
}
