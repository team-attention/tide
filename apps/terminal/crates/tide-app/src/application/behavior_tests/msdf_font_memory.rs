// Spec: docs/specs/msdf-font-memory.md

use crate::tide_renderer::MsdfFontStore;
use std::sync::Arc;

// --- UC-1: RegisterSharedFontFace ---

#[cfg(target_os = "macos")]
#[test]
fn font_aliases_share_the_same_registered_face() {
    // UC-1 BR-1: Aliases generate equivalent metrics and glyphs through one face ID.
    let mut font_system = cosmic_text::FontSystem::new();
    let face_id = {
        let families = [fontdb::Family::Name("Menlo")];
        font_system
            .db()
            .query(&fontdb::Query {
                families: &families,
                weight: fontdb::Weight::NORMAL,
                stretch: fontdb::Stretch::Normal,
                style: fontdb::Style::Normal,
            })
            .expect("Menlo should be available on macOS")
    };
    let mut store = MsdfFontStore::new();

    store.register_font("Menlo", false, false, face_id);
    store.register_font("Monospace", false, false, face_id);
    store.register_font("cosmic-face", true, false, face_id);

    assert_eq!(store.face_id("Menlo", false, false), Some(face_id));
    assert_eq!(store.face_id("Monospace", false, false), Some(face_id));
    assert_eq!(store.face_id("cosmic-face", true, false), Some(face_id));

    let menlo_metrics = store
        .font_metrics(&mut font_system, "Menlo", false, false)
        .expect("Menlo metrics should parse");
    let alias_metrics = store
        .font_metrics(&mut font_system, "Monospace", false, false)
        .expect("alias metrics should parse");
    assert_eq!(menlo_metrics, alias_metrics);

    let menlo_glyph = store
        .generate(&mut font_system, "Menlo", false, false, 'A')
        .expect("Menlo should generate an outlined glyph");
    let alias_glyph = store
        .generate(&mut font_system, "cosmic-face", true, false, 'A')
        .expect("alias should generate the same outlined glyph");
    assert_eq!(menlo_glyph.width, alias_glyph.width);
    assert_eq!(menlo_glyph.height, alias_glyph.height);

    let face_index = font_system
        .db()
        .face(face_id)
        .expect("registered face should remain in fontdb")
        .index;
    let font = font_system
        .get_font(face_id)
        .expect("registered face should remain available");
    let glyph_id = ttf_parser::Face::parse(font.data(), face_index)
        .expect("registered face should parse")
        .glyph_index('A')
        .expect("Menlo should contain A")
        .0;
    let shaped_glyph = store
        .generate_by_glyph_id(&mut font_system, "Monospace", false, false, glyph_id)
        .expect("alias should generate the shaped glyph ID");
    assert_eq!(menlo_glyph.width, shaped_glyph.width);
    assert_eq!(menlo_glyph.height, shaped_glyph.height);
}

#[test]
fn unavailable_font_face_is_not_registered() {
    // UC-1 BR-2: A face unavailable from cosmic-text is not registered.
    let mut db = fontdb::Database::new();
    db.push_face_info(fontdb::FaceInfo {
        id: fontdb::ID::dummy(),
        source: fontdb::Source::Binary(Arc::new(Vec::<u8>::new())),
        index: 0,
        families: vec![(
            "Definitely Broken Font".into(),
            fontdb::Language::English_UnitedStates,
        )],
        post_script_name: "DefinitelyBrokenFont".into(),
        style: fontdb::Style::Normal,
        weight: fontdb::Weight::NORMAL,
        stretch: fontdb::Stretch::Normal,
        monospaced: false,
    });
    let mut font_system = cosmic_text::FontSystem::new_with_locale_and_db("en-US".into(), db);
    let mut store = MsdfFontStore::new();

    assert!(!store.load_font(&mut font_system, "Definitely Broken Font", false, false,));
    assert_eq!(store.face_id("Definitely Broken Font", false, false), None);
}
