import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  newLibraryId,
  librarySaveBlob,
  libraryGet,
  libraryDelete,
  fetchDriveLinkAsBlob,
  isTextEditableMaterial,
  materialsSave,
  materialsGet,
  materialsDelete,
} from "./materialBlobStore.js";
import {
  remoteSaveMaterial,
  remoteRenameMaterial,
  remoteDeleteMaterial,
  remoteGetMaterialSignedUrl,
  remoteDownloadMaterialBlob,
  remoteUpsertClass,
  remoteDeleteClass,
  remoteUpsertUnit,
  remoteDeleteUnit,
  remoteUpsertChapter,
  remoteDeleteChapter,
} from "./api/materialsRemote.js";
import {
  remoteHydrateUserLibrary,
  findCatalogFile,
  mergeQuestionPaperLists,
} from "./api/teachingLoadRemote.js";
import {
  remoteGetQuestionPaperSignedUrl,
  remoteDeleteQuestionPaper,
  remoteSaveQuestionPaper,
  remoteRenameQuestionPaper,
  remoteDownloadQuestionPaperBlob,
} from "./api/questionPapersRemote.js";
import {
  syncQuestionBankFromMaterial,
  syncQuestionBankFromQuestionPaper,
  reclassifyUnassignedExamQuestions,
  reclassifyExamPapersForClass,
  reprocessQuestionPapersWithoutBank,
  reprocessQuestionPaper,
} from "./api/syncQuestionBank.js";
import { remoteQueryQuestionBank } from "./api/questionBankRemote.js";
import {
  questionBankRowToEntry,
  questionsByChapter,
  sortChapterBankQuestions,
} from "./api/questionBankUtils.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

const MATERIAL_CATEGORIES = ["Syllabus", "Class Notes", "Question papers"];
const CHAPTER_MATERIAL_LEFT = ["Class Notes"];
const CHAPTER_MATERIAL_RIGHT = ["Question papers"];
const DEFAULT_MATERIAL_CATEGORY = "Syllabus";
const EXAM_SOURCES = ["Class work", "Test"];
const DEFAULT_EXAM_SOURCE = "Class work";

function normalizeMaterialCategory(file) {
  const raw = file.materialCategory || DEFAULT_MATERIAL_CATEGORY;
  return raw === "Others" ? "Syllabus" : raw;
}

/** Map legacy labels from older app versions / DB rows. */
function normalizeExamSource(src) {
  if (src === "Class test" || src === "Public exam") return "Class work";
  if (EXAM_SOURCES.includes(src)) return src;
  return DEFAULT_EXAM_SOURCE;
}

const QUESTION_PAPER_SOURCES = ["Final exam", "Model exam", "Others"];
const DEFAULT_QUESTION_PAPER_SOURCE = "Final exam";

function groupQuestionPapersByClassAndSource(papers, catalog) {
  const classIds = catalog.map((c) => c.id);
  const extraIds = [...new Set(papers.map((p) => p.classId))].filter(
    (id) => !classIds.includes(id)
  );
  const orderedClassIds = [...classIds, ...extraIds];
  return orderedClassIds
    .map((classId) => {
      const items = papers.filter((p) => p.classId === classId);
      if (!items.length) return null;
      const className =
        catalog.find((c) => c.id === classId)?.name || items[0].className;
      const sourceGroups = QUESTION_PAPER_SOURCES.map((source) => ({
        source,
        papers: items
          .filter((p) => p.paperSource === source)
          .sort((a, b) => (b.year || 0) - (a.year || 0)),
      })).filter((g) => g.papers.length > 0);
      return { classId, className, sourceGroups };
    })
    .filter(Boolean);
}

function questionPaperYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 10 }, (_, i) => current - i);
}

function previewFileShape(record) {
  if (!record) return record;
  return {
    ...record,
    type: record.type || record.fileType || "File",
  };
}

function emptyQuestionPaperDraft() {
  return {
    step: "choose",
    classId: "",
    file: null,
    link: "",
    displayName: "",
    paperSource: DEFAULT_QUESTION_PAPER_SOURCE,
    year: String(new Date().getFullYear()),
  };
}

const MATERIAL_LOCAL_FILE_ACCEPT =
  "image/*,.pdf,.doc,.docx,.gdoc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*";

const SEEDED_CATALOG = [
  {
    id: "class-xi",
    name: "Class XI",
    units: [
      {
        id: "unit-1",
        name: "Unit-I",
        title: "Physical World and Measurement",
        marks: 23,
        chapters: [{ id: "chapter-1", name: "Chapter-1: Units and Measurements", files: [] }],
      },
      {
        id: "unit-2",
        name: "Unit-II",
        title: "Kinematics",
        marks: 23,
        chapters: [
          { id: "chapter-2", name: "Chapter-2: Motion in a Straight Line", files: [] },
          { id: "chapter-3", name: "Chapter-3: Motion in a Plane", files: [] },
        ],
      },
      {
        id: "unit-3",
        name: "Unit-III",
        title: "Laws of Motion",
        marks: 23,
        chapters: [{ id: "chapter-4", name: "Chapter-4: Laws of Motion", files: [] }],
      },
      {
        id: "unit-4",
        name: "Unit-IV",
        title: "Work, Energy and Power",
        marks: 17,
        chapters: [{ id: "chapter-5", name: "Chapter-5: Work, Energy and Power", files: [] }],
      },
      {
        id: "unit-5",
        name: "Unit-V",
        title: "Motion of System of Particles and Rigid Body",
        marks: 17,
        chapters: [
          {
            id: "chapter-6",
            name: "Chapter-6: System of Particles and Rotational Motion",
            files: [],
          },
        ],
      },
      {
        id: "unit-6",
        name: "Unit-VI",
        title: "Gravitation",
        marks: 17,
        chapters: [{ id: "chapter-7", name: "Chapter-7: Gravitation", files: [] }],
      },
      {
        id: "unit-7",
        name: "Unit-VII",
        title: "Properties of Bulk Matter",
        marks: 20,
        chapters: [
          { id: "chapter-8", name: "Chapter-8: Mechanical Properties of Solids", files: [] },
          { id: "chapter-9", name: "Chapter-9: Mechanical Properties of Fluids", files: [] },
          { id: "chapter-10", name: "Chapter-10: Thermal Properties of Matter", files: [] },
        ],
      },
      {
        id: "unit-8",
        name: "Unit-VIII",
        title: "Thermodynamics",
        marks: 20,
        chapters: [{ id: "chapter-11", name: "Chapter-11: Thermodynamics", files: [] }],
      },
      {
        id: "unit-9",
        name: "Unit-IX",
        title: "Behaviour of Perfect Gases and Kinetic Theory of Gases",
        marks: 20,
        chapters: [{ id: "chapter-12", name: "Chapter-12: Kinetic Theory", files: [] }],
      },
      {
        id: "unit-10",
        name: "Unit-X",
        title: "Oscillations and Waves",
        marks: 10,
        chapters: [
          { id: "chapter-13", name: "Chapter-13: Oscillations", files: [] },
          { id: "chapter-14", name: "Chapter-14: Waves", files: [] },
        ],
      },
    ],
  },
  {
    id: "class-xii",
    name: "Class XII",
    units: [
      {
        id: "xii-unit-1",
        name: "Unit-I",
        title: "Electrostatics",
        marks: 16,
        chapters: [
          { id: "xii-chapter-1", name: "Chapter-1: Electric Charges and Fields", files: [] },
          {
            id: "xii-chapter-2",
            name: "Chapter-2: Electrostatic Potential and Capacitance",
            files: [],
          },
        ],
      },
      {
        id: "xii-unit-2",
        name: "Unit-II",
        title: "Current Electricity",
        marks: "",
        chapters: [
          { id: "xii-chapter-3", name: "Chapter-3: Current Electricity", files: [] },
        ],
      },
      {
        id: "xii-unit-3",
        name: "Unit-III",
        title: "Magnetic Effects of Current and Magnetism",
        marks: 17,
        chapters: [
          { id: "xii-chapter-4", name: "Chapter-4: Moving Charges and Magnetism", files: [] },
          { id: "xii-chapter-5", name: "Chapter-5: Magnetism and Matter", files: [] },
        ],
      },
      {
        id: "xii-unit-4",
        name: "Unit-IV",
        title: "Electromagnetic Induction and Alternating Currents",
        marks: "",
        chapters: [
          { id: "xii-chapter-6", name: "Chapter-6: Electromagnetic Induction", files: [] },
          { id: "xii-chapter-7", name: "Chapter-7: Alternating Current", files: [] },
        ],
      },
      {
        id: "xii-unit-5",
        name: "Unit-V",
        title: "Electromagnetic Waves",
        marks: 18,
        chapters: [
          { id: "xii-chapter-8", name: "Chapter-8: Electromagnetic Waves", files: [] },
        ],
      },
      {
        id: "xii-unit-6",
        name: "Unit-VI",
        title: "Optics",
        marks: "",
        chapters: [
          {
            id: "xii-chapter-9",
            name: "Chapter-9: Ray Optics and Optical Instruments",
            files: [],
          },
          { id: "xii-chapter-10", name: "Chapter-10: Wave Optics", files: [] },
        ],
      },
      {
        id: "xii-unit-7",
        name: "Unit-VII",
        title: "Dual Nature of Radiation and Matter",
        marks: 12,
        chapters: [
          {
            id: "xii-chapter-11",
            name: "Chapter-11: Dual Nature of Radiation and Matter",
            files: [],
          },
        ],
      },
      {
        id: "xii-unit-8",
        name: "Unit-VIII",
        title: "Atoms and Nuclei",
        marks: "",
        chapters: [
          { id: "xii-chapter-12", name: "Chapter-12: Atoms", files: [] },
          { id: "xii-chapter-13", name: "Chapter-13: Nuclei", files: [] },
        ],
      },
      {
        id: "xii-unit-9",
        name: "Unit-IX",
        title: "Electronic Devices",
        marks: 7,
        chapters: [
          {
            id: "xii-chapter-14",
            name: "Chapter-14: Semiconductor Electronics: Materials, Devices and Simple Circuits",
            files: [],
          },
        ],
      },
    ],
  },
];

function navigateTo(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function catalogForStorage(catalog) {
  return catalog.map((c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      chapters: u.chapters.map((ch) => ({
        ...ch,
        files: ch.files.map((f) => {
          const { objectUrl: _o, ...rest } = f;
          return rest;
        }),
      })),
    })),
  }));
}

function teachingCatalogStorageKey(ownerId) {
  if (!ownerId) throw new Error("teachingCatalogStorageKey requires ownerId");
  return `teachingCatalog:${ownerId}`;
}

function questionBankPapersStorageKey(ownerId) {
  if (!ownerId) throw new Error("questionBankPapersStorageKey requires ownerId");
  return `questionBankPapers:${ownerId}`;
}

/** Move pre-auth localStorage into the signed-in user's namespace. */
function migrateUnscopedStorageToUser(ownerId) {
  if (!ownerId) return;
  const catalogKey = teachingCatalogStorageKey(ownerId);
  const papersKey = questionBankPapersStorageKey(ownerId);
  if (!window.localStorage.getItem(catalogKey)) {
    const legacyCatalog = window.localStorage.getItem("teachingCatalog");
    if (legacyCatalog) {
      window.localStorage.setItem(catalogKey, legacyCatalog);
    }
  }
  if (!window.localStorage.getItem(papersKey)) {
    const legacyPapers = window.localStorage.getItem("questionBankPapers");
    if (legacyPapers) {
      window.localStorage.setItem(papersKey, legacyPapers);
    }
  }
  window.localStorage.removeItem("teachingCatalog");
  window.localStorage.removeItem("questionBankPapers");
  window.sessionStorage.removeItem("authMethod");
}

function loadTeachingCatalog(storageKey) {
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return SEEDED_CATALOG;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return SEEDED_CATALOG;
    const merged = [...parsed];
    for (const seedClass of SEEDED_CATALOG) {
      if (!merged.some((c) => c?.id === seedClass.id)) {
        merged.push(seedClass);
      }
    }
    return merged;
  } catch {
    return SEEDED_CATALOG;
  }
}

function collectLibraryIds(catalog) {
  const ids = [];
  for (const c of catalog) {
    for (const u of c.units) {
      for (const ch of u.chapters) {
        for (const f of ch.files) {
          if (f?.id) ids.push(f.id);
        }
      }
    }
  }
  return ids;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function guessExtFromMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) {
    const sub = m.split("/")[1];
    if (sub === "jpeg") return "jpg";
    return sub || "img";
  }
  if (m.startsWith("text/")) return "txt";
  if (m.includes("wordprocessingml") || m.includes("msword")) return "docx";
  return "bin";
}

function categoryFromBlob(blob, fallbackName = "") {
  const mime = (blob.type || "").toLowerCase();
  const name = fallbackName.toLowerCase();
  if (mime.startsWith("image/")) return "Image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (
    mime.includes("word") ||
    mime.includes("officedocument") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return "Microsoft Document";
  }
  if (name.endsWith(".gdoc")) return "Google Doc";
  if (mime.startsWith("text/")) return "Text";
  return "Microsoft Document";
}

function buildCompiledHtmlDocument({ className, unitName, unitTitle, chapterName, files }) {
  const sections = files
    .map((f, i) => {
      const n = i + 1;
      const href = f.exportHref ?? "#";
      const safeName = escapeHtml(f.name);
      const safeHref = escapeHtml(href);
      return `
    <section id="source-${n}">
      <h2>Source ${n}: ${safeName}</h2>
      <p><span class="meta">${escapeHtml(f.type)} · Library copy</span></p>
      <p><a href="${safeHref}" target="_blank" rel="noopener">Open file ↗</a></p>
    </section>`;
    })
    .join("\n");

  const index = files
    .map((f, i) => {
      const href = f.exportHref ?? "#";
      return `<li><a href="${escapeHtml(href)}">Source ${i + 1}: ${escapeHtml(f.name)}</a></li>`;
    })
    .join("\n");

  const unitLine = `${escapeHtml(unitName)}${unitTitle ? ` — ${escapeHtml(unitTitle)}` : ""}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(chapterName)} — Compiled</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; line-height: 1.5; color: #0a1929; }
    h1 { font-family: Georgia, serif; }
    .meta { color: #556; font-size: 0.95rem; }
    section { border-top: 1px solid #ded8cc; padding: 1rem 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(chapterName)}</h1>
  <p>${escapeHtml(className)} · ${unitLine}</p>
  <p><strong>Compiled view</strong> — each section is a copy stored in your library.</p>
  ${sections}
  <h2>Source index</h2>
  <ol>${index}</ol>
</body>
</html>`;
}

function DashboardPage({ onSignOut }) {
  const actions = [
    {
      icon: "📖",
      iconClass: "icon-gold",
      tag: "LIVE",
      title: "Start class",
      description: "Open the live room and begin today's lesson.",
    },
    {
      icon: "📝",
      iconClass: "icon-navy",
      tag: "NEW",
      title: "Create assignment",
      description: "Compose a new task with rubric and deadline.",
    },
    {
      icon: "🗂",
      iconClass: "icon-mint",
      tag: "LIBRARY",
      title: "Manage materials",
      description: "Curate notes, slides and reference reading.",
      path: "/materials",
    },
    {
      icon: "🔗",
      iconClass: "icon-rose",
      tag: "SEND",
      title: "Share materials",
      description: "Send a packet to a class or single student.",
    },
    {
      icon: "💬",
      iconClass: "icon-navy",
      tag: "12 UNREAD",
      title: "Communicate",
      description: "Chat, broadcast updates, schedule a parent call.",
    },
  ];

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span className="brand-name">Enlightly</span>
        </div>
        <div className="topbar-actions">
          <button className="signout-btn" type="button" onClick={onSignOut}>
            Sign out
          </button>
          <button className="avatar" type="button">
            LY
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">VOL. 01 · THE TEACHER'S DESK</p>
        <h1>Good morning, Layyoni. Three classes await today.</h1>
        <p className="subtext">
          You have 12 messages, 4 assignments to grade, and a parent meeting at 6:30 PM.
        </p>
      </section>

      <section className="metric-card">
        <div className="metric-icon">🗓</div>
        <p className="metric-value">6</p>
        <p className="metric-label">CLASSES / WK</p>
      </section>

      <section className="actions">
        <h2>What would you like to do?</h2>
        <div className="actions-grid">
          {actions.map((action) => (
            <article key={action.title} className="action-card">
              <div className="action-head">
                <span className={`action-icon ${action.iconClass}`}>{action.icon}</span>
                <span className="pill">{action.tag}</span>
              </div>
              <h3>{action.title}</h3>
              <p>{action.description}</p>
              <button
                className="action-link"
                type="button"
                aria-label={`Open ${action.title}`}
                onClick={() => navigateTo(action.path ?? "#")}
              >
                Open ↗
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="schedule-card">
        <div className="schedule-head">
          <h2>Today's Schedule</h2>
          <span className="pill">AGENDA</span>
        </div>
        <div className="schedule-row">
          <p className="time">09:00</p>
          <div>
            <p className="class-title">Class X · Algebra II</p>
            <p className="class-subtitle">Quadratic equations</p>
          </div>
          <button type="button">NOTES</button>
        </div>
      </section>
    </main>
  );
}

function MaterialsPage({ onSignOut, ownerId }) {
  const catalogStorageKey = teachingCatalogStorageKey(ownerId);
  const [isCreateClassOpen, setIsCreateClassOpen] = useState(false);
  const [classNameInput, setClassNameInput] = useState("");
  const [expandedClassIds, setExpandedClassIds] = useState({});
  const isClassExpanded = (id) => !!expandedClassIds[id];
  const toggleClassExpanded = (id) =>
    setExpandedClassIds((prev) => ({ ...prev, [id]: !prev[id] }));
  const [expandedUnitIds, setExpandedUnitIds] = useState({});
  const isUnitExpanded = (id) => !!expandedUnitIds[id];
  const toggleUnitExpanded = (id) =>
    setExpandedUnitIds((prev) => ({ ...prev, [id]: !prev[id] }));
  const ensureUnitExpanded = (id) =>
    setExpandedUnitIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  const [unitEditorForClassId, setUnitEditorForClassId] = useState("");
  const [unitDraftByClass, setUnitDraftByClass] = useState({});
  const [unitMarksByClass, setUnitMarksByClass] = useState({});
  const [chapterEditorForUnitId, setChapterEditorForUnitId] = useState("");
  const [chapterNameByUnit, setChapterNameByUnit] = useState({});
  const [materialEditorForUnitId, setMaterialEditorForUnitId] = useState("");
  const [selectedChapterByUnit, setSelectedChapterByUnit] = useState({});
  const [displayNameByUnit, setDisplayNameByUnit] = useState({});
  const [driveLinkByUnit, setDriveLinkByUnit] = useState({});
  const [driveTitleByUnit, setDriveTitleByUnit] = useState({});
  const [documentDraftByUnit, setDocumentDraftByUnit] = useState({});

  const cancelDocumentDraft = (unitId) => {
    if (materialPickUnitRef.current === unitId) {
      materialPickUnitRef.current = null;
    }
    setDocumentDraftByUnit((prev) => {
      const next = { ...prev };
      delete next[unitId];
      return next;
    });
  };

  const closeMaterialEditor = (unitId) => {
    cancelDocumentDraft(unitId);
    setMaterialEditorForUnitId((prev) => (prev === unitId ? "" : prev));
    setSelectedChapterByUnit((prev) => {
      const next = { ...prev };
      delete next[unitId];
      return next;
    });
  };

  const triggerMaterialLocalPicker = (unitId) => {
    materialPickUnitRef.current = unitId;
    requestAnimationFrame(() => {
      materialLocalPickInputRef.current?.click();
    });
  };

  const onMaterialLocalFilePicked = (event) => {
    const unitId = materialPickUnitRef.current;
    materialPickUnitRef.current = null;
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!unitId || !file) return;
    setDocumentDraftByUnit((prev) => ({
      ...prev,
      [unitId]: {
        step: "local",
        file,
        link: "",
        displayName: file.name,
        materialCategory:
          prev[unitId]?.materialCategory || DEFAULT_MATERIAL_CATEGORY,
        examSource: prev[unitId]?.examSource || DEFAULT_EXAM_SOURCE,
      },
    }));
  };

  const setDraftField = (unitId, patch) => {
    setDocumentDraftByUnit((prev) => ({
      ...prev,
      [unitId]: { ...(prev[unitId] || {}), ...patch },
    }));
  };

  const addEntryToChapter = (classId, unitId, chapterId, entry) => {
    setCatalog((prev) =>
      prev.map((classItem) =>
        classItem.id !== classId
          ? classItem
          : {
              ...classItem,
              units: classItem.units.map((unit) =>
                unit.id !== unitId
                  ? unit
                  : {
                      ...unit,
                      chapters: unit.chapters.map((chapter) =>
                        chapter.id !== chapterId
                          ? chapter
                          : { ...chapter, files: [...chapter.files, entry] }
                      ),
                    }
              ),
            }
      )
    );
  };

  const buildMaterialMetaSnapshot = (classId, unitId, chapterId) => {
    const classItem = catalog.find((c) => c.id === classId);
    const unit = classItem?.units.find((u) => u.id === unitId);
    const chapter = unit?.chapters.find((c) => c.id === chapterId);
    return {
      className: classItem?.name || "",
      unitName: unit?.name || "",
      unitTitle: unit?.title || "",
      chapterName: chapter?.name || "",
    };
  };

  const persistMaterialRecord = async (
    {
      id,
      name,
      classId,
      unitId,
      chapterId,
      materialCategory,
      fileType,
      mimeType,
      source,
      examSource,
    },
    blob
  ) => {
    const isQuestionPaper = materialCategory === "Question papers";
    const meta = buildMaterialMetaSnapshot(classId, unitId, chapterId);
    const record = {
      id,
      name,
      materialType: materialCategory,
      fileType,
      mimeType,
      classId,
      unitId,
      chapterId,
      className: meta.className,
      unitName: meta.unitName,
      unitTitle: meta.unitTitle,
      chapterName: meta.chapterName,
      source,
      examSource: isQuestionPaper
        ? normalizeExamSource(examSource)
        : null,
      questions: [],
    };
    try {
      await materialsSave(record);
    } catch (err) {
      console.error("materialsSave failed", err);
    }
    try {
      const { error: remoteError } = await remoteSaveMaterial(
        ownerId,
        record,
        blob,
        catalog
      );
      if (remoteError) {
        setMaterialError(
          `Saved on this device, but cloud sync failed: ${remoteError}`
        );
      }

      if (isQuestionPaper && blob) {
        setLibraryNotice(null);
        const sync = await syncQuestionBankFromMaterial(ownerId, record, blob, {
          remoteOk: !remoteError,
        });
        if (sync.questions.length) {
          record.questions = sync.questions;
          try {
            await materialsSave({ ...record, questions: sync.questions });
          } catch (err) {
            console.error("materialsSave questions failed", err);
          }
        }
        if (sync.error) {
          setMaterialError(
            `File saved, but question bank update failed: ${sync.error}`
          );
        } else if (sync.count > 0) {
          await refreshQuestionBankEntries();
          setLibraryNotice(
            `Added ${sync.count} question${sync.count === 1 ? "" : "s"} to the question bank (${sync.extractedBy}).`
          );
        } else if (sync.count === 0 && !sync.error) {
          setLibraryNotice(
            "File saved. No questions could be read from this PDF yet — set VITE_OPENAI_API_KEY in .env.local for AI extraction."
          );
        }
      }
    } catch (err) {
      console.error("remoteSaveMaterial failed", err);
      setMaterialError(
        `Saved on this device, but cloud sync failed: ${err.message || err}`
      );
    }
  };

  const saveDocumentDraft = async (classId, unitId, chapterId) => {
    const draft = documentDraftByUnit[unitId];
    if (!draft) return;
    if (!chapterId) {
      setMaterialError("Select a chapter for this material.");
      return;
    }
    setMaterialError(null);

    if (draft.step === "local") {
      const file = draft.file;
      if (!file) return;
      const category = getFileCategory(file);
      if (!category) {
        setMaterialError("This file type is not supported.");
        return;
      }
      setImportBusy(true);
      try {
        const id = newLibraryId();
        const finalName = (draft.displayName || "").trim() || file.name;
        const mimeType = file.type || "application/octet-stream";
        await librarySaveBlob(id, file, { name: finalName, mimeType });
        const materialCategory =
          draft.materialCategory || DEFAULT_MATERIAL_CATEGORY;
        const examSource =
          materialCategory === "Question papers"
            ? normalizeExamSource(draft.examSource)
            : null;
        const entry = {
          id,
          name: finalName,
          type: category,
          materialCategory,
          mimeType,
          storedAt: new Date().toISOString(),
          examSource,
          source: { kind: "local", origin: file.name },
        };
        addEntryToChapter(classId, unitId, chapterId, entry);
        await persistMaterialRecord(
          {
            id,
            name: finalName,
            classId,
            unitId,
            chapterId,
            materialCategory,
            fileType: category,
            mimeType,
            source: entry.source,
            examSource,
          },
          file
        );
        closeMaterialEditor(unitId);
        if (materialCategory === "Syllabus") {
          void reclassifyExamPapersAfterSyllabus(classId);
        }
      } catch (err) {
        setMaterialError(err.message || "Could not save file.");
      } finally {
        setImportBusy(false);
      }
      return;
    }

    if (draft.step === "drive") {
      const link = (draft.link || "").trim();
      if (!link) return;
      setImportBusy(true);
      try {
        const blob = await fetchDriveLinkAsBlob(link);
        const id = newLibraryId();
        const baseName = (draft.displayName || "").trim() || "library-import";
        const ext = guessExtFromMime(blob.type);
        const name = baseName.includes(".") ? baseName : `${baseName}.${ext}`;
        const category = categoryFromBlob(blob, name);
        const mimeType = blob.type || "application/octet-stream";
        await librarySaveBlob(id, blob, { name, mimeType });
        const materialCategory =
          draft.materialCategory || DEFAULT_MATERIAL_CATEGORY;
        const examSource =
          materialCategory === "Question papers"
            ? normalizeExamSource(draft.examSource)
            : null;
        const entry = {
          id,
          name,
          type: category,
          materialCategory,
          mimeType,
          storedAt: new Date().toISOString(),
          examSource,
          source: { kind: "drive", origin: link },
        };
        addEntryToChapter(classId, unitId, chapterId, entry);
        await persistMaterialRecord(
          {
            id,
            name,
            classId,
            unitId,
            chapterId,
            materialCategory,
            fileType: category,
            mimeType,
            source: entry.source,
            examSource,
          },
          blob
        );
        closeMaterialEditor(unitId);
        if (materialCategory === "Syllabus") {
          void reclassifyExamPapersAfterSyllabus(classId);
        }
      } catch (err) {
        setMaterialError(
          err.message || "Could not import from Drive. Choose the file from local instead."
        );
      } finally {
        setImportBusy(false);
      }
    }
  };
  const [compiledModal, setCompiledModal] = useState(null);
  const [catalog, setCatalog] = useState(SEEDED_CATALOG);
  const [questionBankSets, setQuestionBankSets] = useState([]);
  const [questionBankInput, setQuestionBankInput] = useState("");
  const [questionPaperEditorOpen, setQuestionPaperEditorOpen] = useState(false);
  const [questionPaperDraft, setQuestionPaperDraft] = useState(null);
  const [questionBankPapers, setQuestionBankPapers] = useState([]);
  const [questionBankEntries, setQuestionBankEntries] = useState([]);
  const [practiseQuestionsModal, setPractiseQuestionsModal] = useState(null);
  const [visibleChapterSolutions, setVisibleChapterSolutions] = useState(
    () => new Set()
  );
  const [classifyingBusy, setClassifyingBusy] = useState(false);
  const [libraryHydrating, setLibraryHydrating] = useState(false);
  const questionPaperPickRef = useRef(false);
  const questionPaperLocalInputRef = useRef(null);

  const qbPapersKey = questionBankPapersStorageKey(ownerId);

  useEffect(() => {
    const localCatalog = loadTeachingCatalog(catalogStorageKey);
    setCatalog(localCatalog);

    let savedPapers = [];
    try {
      const saved = window.localStorage.getItem(qbPapersKey);
      savedPapers = saved ? JSON.parse(saved) : [];
    } catch {
      savedPapers = [];
    }
    setQuestionBankPapers(savedPapers);

    if (!ownerId || !isSupabaseConfigured) return undefined;

    let cancelled = false;
    setLibraryHydrating(true);
    void remoteHydrateUserLibrary(ownerId, localCatalog).then(
      async ({ catalog: merged, questionPapers, questionBankEntries: qbRows, error }) => {
        if (cancelled) return;
        setCatalog(merged);
        const mergedPapers = mergeQuestionPaperLists(savedPapers, questionPapers);
        setQuestionBankPapers(mergedPapers);
        const entries = (qbRows || []).map(questionBankRowToEntry);
        setQuestionBankEntries(entries);
        setLibraryHydrating(false);
        if (error) {
          setMaterialError(`Some library data could not be synced: ${error}`);
        }

        if (mergedPapers.length) {
          setClassifyingBusy(true);
          try {
            const reprocess = await reprocessQuestionPapersWithoutBank(
              ownerId,
              mergedPapers,
              merged,
              entries,
              {
                libraryGet,
                librarySaveBlob,
                remoteDownloadQuestionPaper: remoteDownloadQuestionPaperBlob,
                normalizeMaterialCategory,
                remoteDownloadMaterial: remoteDownloadMaterialBlob,
              }
            );
            if (cancelled) return;
            if (reprocess.processed > 0) {
              const refreshed = await remoteQueryQuestionBank(ownerId, {});
              if (!cancelled) {
                setQuestionBankEntries(refreshed.map(questionBankRowToEntry));
              }
              setLibraryNotice(
                `Extracted ${reprocess.totalQuestions} question${reprocess.totalQuestions === 1 ? "" : "s"} from ${reprocess.processed} paper${reprocess.processed === 1 ? "" : "s"}${reprocess.assignedCount > 0 ? `; ${reprocess.assignedCount} assigned to chapters` : ". Upload syllabus PDFs per chapter to improve chapter matching."}`
              );
            } else if (
              reprocess.error &&
              mergedPapers.some(
                (p) => !entries.some((e) => e.questionPaperId === p.id)
              )
            ) {
              setMaterialError(reprocess.error);
            }
          } catch (err) {
            console.warn("[reprocessQuestionPapers]", err);
          } finally {
            if (!cancelled) setClassifyingBusy(false);
          }
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [ownerId, catalogStorageKey, qbPapersKey]);

  useEffect(() => {
    window.localStorage.setItem(qbPapersKey, JSON.stringify(questionBankPapers));
  }, [questionBankPapers, qbPapersKey]);

  useEffect(() => {
    window.localStorage.setItem(
      catalogStorageKey,
      JSON.stringify(catalogForStorage(catalog))
    );
  }, [catalog, catalogStorageKey]);

  const [urlByLibraryId, setUrlByLibraryId] = useState({});
  const [editModal, setEditModal] = useState(null);
  const [editText, setEditText] = useState("");
  const [fileWindowModal, setFileWindowModal] = useState(null);
  const [fileRenameEditing, setFileRenameEditing] = useState(false);
  const [fileRenameDraft, setFileRenameDraft] = useState("");
  const [materialError, setMaterialError] = useState(null);
  const [libraryNotice, setLibraryNotice] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const replaceFileInputRef = useRef(null);
  const replaceTargetRef = useRef(null);
  const previewBodyRef = useRef(null);
  const materialLocalPickInputRef = useRef(null);
  const materialPickUnitRef = useRef(null);

  const requestPreviewFullscreen = (file) => {
    const el = previewBodyRef.current;
    if (!el) return;
    const href = hrefFor(file);
    const request =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (typeof request === "function") {
      try {
        const result = request.call(el);
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            if (href) window.open(href, "_blank", "noopener,noreferrer");
          });
        }
        return;
      } catch {
        /* fall through to new tab */
      }
    }
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  const exitPreviewFullscreen = () => {
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (typeof exit === "function") {
      try {
        const result = exit.call(document);
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    let alive = true;
    const created = [];

    (async () => {
      const ids = new Set([
        ...collectLibraryIds(catalog),
        ...questionBankPapers.map((p) => p.id),
      ]);
      const map = {};
      for (const id of ids) {
        const rec = await libraryGet(id);
        if (!alive) return;
        if (rec?.blob) {
          const u = URL.createObjectURL(rec.blob);
          created.push(u);
          map[id] = u;
          continue;
        }
        if (!ownerId || !isSupabaseConfigured) continue;

        const catalogHit = findCatalogFile(catalog, id);
        if (catalogHit?.file?.remoteStoragePath) {
          const url = await remoteGetMaterialSignedUrl(ownerId, id);
          if (url) map[id] = url;
          continue;
        }

        const paper = questionBankPapers.find((p) => p.id === id);
        if (paper?.remoteStoragePath) {
          const url = await remoteGetQuestionPaperSignedUrl(ownerId, id);
          if (url) map[id] = url;
        }
      }
      if (!alive) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setUrlByLibraryId((prev) => {
        Object.values(prev).forEach((u) => {
          if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
        return map;
      });
    })();

    return () => {
      alive = false;
    };
  }, [catalog, questionBankPapers, ownerId]);

  const papersById = useMemo(
    () => Object.fromEntries(questionBankPapers.map((p) => [p.id, p])),
    [questionBankPapers]
  );

  const questionCountByPaperId = useMemo(() => {
    const map = {};
    for (const entry of questionBankEntries) {
      if (entry.questionPaperId) {
        map[entry.questionPaperId] = (map[entry.questionPaperId] || 0) + 1;
      }
    }
    return map;
  }, [questionBankEntries]);

  const questionBankBlobOptions = {
    libraryGet,
    librarySaveBlob,
    remoteDownloadQuestionPaper: remoteDownloadQuestionPaperBlob,
  };

  const refreshQuestionBankEntries = async () => {
    if (!ownerId || !isSupabaseConfigured) return;
    const rows = await remoteQueryQuestionBank(ownerId, {});
    setQuestionBankEntries(rows.map(questionBankRowToEntry));
  };

  const runExamChapterClassification = async (
    papers,
    { classId = null, noticePrefix = "Classification" } = {}
  ) => {
    if (!ownerId) return null;
    const result = classId
      ? await reclassifyExamPapersForClass(
          ownerId,
          papers,
          catalog,
          classId,
          normalizeMaterialCategory,
          {
            remoteDownloadMaterial: remoteDownloadMaterialBlob,
            ...questionBankBlobOptions,
          }
        )
      : await reclassifyUnassignedExamQuestions(
          ownerId,
          papers,
          catalog,
          normalizeMaterialCategory,
          {
            remoteDownloadMaterial: remoteDownloadMaterialBlob,
            ...questionBankBlobOptions,
          }
        );
    await refreshQuestionBankEntries();
    return { result, noticePrefix };
  };

  const reclassifyExamPapersAfterSyllabus = async (classId) => {
    const papersForClass = questionBankPapers.filter((p) => p.classId === classId);
    if (!papersForClass.length || !ownerId) return;
    setClassifyingBusy(true);
    try {
      const wrapped = await runExamChapterClassification(papersForClass, { classId });
      const result = wrapped?.result;
      if (result?.error) {
        setMaterialError(
          `Syllabus saved, but exam classification failed: ${result.error}`
        );
      } else if (result?.assignedCount > 0) {
        setLibraryNotice(
          `Syllabus saved. ${result.assignedCount} exam question${result.assignedCount === 1 ? "" : "s"} assigned to chapters (${result.classifiedBy}).`
        );
      }
    } catch (err) {
      console.warn("[reclassifyExamPapersAfterSyllabus]", err);
    } finally {
      setClassifyingBusy(false);
    }
  };

  const hrefFor = (file) => urlByLibraryId[file?.id] || file?.link || null;

  const openLibraryFile = (file) => {
    const href = hrefFor(file);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  const openQuestionPaperFileWindow = (paper, classItem) => {
    setFileRenameEditing(false);
    setFileRenameDraft("");
    setFileWindowModal({
      kind: "questionPaper",
      paper,
      classItem:
        classItem ||
        catalog.find((c) => c.id === paper.classId) || {
          id: paper.classId,
          name: paper.className || paper.classId,
        },
      file: previewFileShape(paper),
    });
  };

  const closeFileWindowModal = () => {
    setFileWindowModal(null);
    setFileRenameEditing(false);
    setFileRenameDraft("");
  };

  const startFileRename = () => {
    if (!fileWindowModal) return;
    setFileRenameDraft(fileWindowModal.file.name);
    setFileRenameEditing(true);
  };

  const cancelFileRename = () => {
    setFileRenameEditing(false);
    setFileRenameDraft("");
  };

  const renameFileDisplayName = async () => {
    if (!fileWindowModal) return;
    const newName = fileRenameDraft.trim();
    if (!newName) {
      setMaterialError("Display name cannot be empty.");
      return;
    }
    const { file } = fileWindowModal;
    if (newName === file.name) {
      cancelFileRename();
      return;
    }

    if (fileWindowModal.kind === "questionPaper") {
      const { paper } = fileWindowModal;
      setQuestionBankPapers((prev) =>
        prev.map((p) => (p.id === paper.id ? { ...p, name: newName } : p))
      );
      setFileWindowModal((prev) =>
        prev
          ? {
              ...prev,
              paper: { ...prev.paper, name: newName },
              file: { ...prev.file, name: newName },
            }
          : null
      );
      try {
        const lib = await libraryGet(paper.id);
        if (lib?.blob) {
          await librarySaveBlob(paper.id, lib.blob, {
            name: newName,
            mimeType: lib.mimeType || paper.mimeType,
          });
        }
      } catch (err) {
        console.error("rename question paper local save failed", err);
      }
      if (ownerId) {
        const remoteErr = await remoteRenameQuestionPaper(ownerId, paper.id, newName);
        if (remoteErr) {
          setMaterialError(
            `Renamed on this device, but cloud sync failed: ${remoteErr}`
          );
        }
      }
      cancelFileRename();
      return;
    }

    const { classItem, unit, chapter } = fileWindowModal;
    const classId = classItem.id;
    const unitId = unit.id;
    const chapterId = chapter.id;

    setCatalog((prev) =>
      prev.map((c) =>
        c.id !== classId
          ? c
          : {
              ...c,
              units: c.units.map((u) =>
                u.id !== unitId
                  ? u
                  : {
                      ...u,
                      chapters: u.chapters.map((ch) =>
                        ch.id !== chapterId
                          ? ch
                          : {
                              ...ch,
                              files: ch.files.map((f) =>
                                f.id === file.id ? { ...f, name: newName } : f
                              ),
                            }
                      ),
                    }
              ),
            }
      )
    );

    setFileWindowModal((prev) =>
      prev ? { ...prev, file: { ...prev.file, name: newName } } : null
    );
    setCompiledModal((prev) => {
      if (!prev || prev.chapter.id !== chapterId) return prev;
      return {
        ...prev,
        chapter: {
          ...prev.chapter,
          files: prev.chapter.files.map((f) =>
            f.id === file.id ? { ...f, name: newName } : f
          ),
        },
      };
    });

    try {
      const meta = await materialsGet(file.id);
      if (meta) {
        await materialsSave({ ...meta, name: newName });
      }
      const lib = await libraryGet(file.id);
      if (lib?.blob) {
        await librarySaveBlob(file.id, lib.blob, {
          name: newName,
          mimeType: lib.mimeType || file.mimeType,
        });
      }
    } catch (err) {
      console.error("renameMaterialDisplayName local save failed", err);
      setMaterialError("Could not save the new name on this device.");
      return;
    }

    if (ownerId) {
      const remoteErr = await remoteRenameMaterial(ownerId, file.id, newName);
      if (remoteErr) {
        setMaterialError(
          `Renamed on this device, but cloud sync failed: ${remoteErr}`
        );
      }
    }

    cancelFileRename();
  };

  const removeFileFromCatalog = (classId, unitId, chapterId, fileId) => {
    setCatalog((prev) =>
      prev.map((classItem) =>
        classItem.id !== classId
          ? classItem
          : {
              ...classItem,
              units: classItem.units.map((unit) =>
                unit.id !== unitId
                  ? unit
                  : {
                      ...unit,
                      chapters: unit.chapters.map((chapter) =>
                        chapter.id !== chapterId
                          ? chapter
                          : {
                              ...chapter,
                              files: chapter.files.filter((f) => f.id !== fileId),
                            }
                      ),
                    }
              ),
            }
      )
    );
  };

  const purgeMaterialFromCloud = async (fileId) => {
    if (!ownerId || !isSupabaseConfigured) {
      await remoteDeleteMaterial(ownerId, fileId);
      return null;
    }
    return remoteDeleteMaterial(ownerId, fileId);
  };

  const purgeQuestionPaperFromCloud = async (paperId) => {
    if (!ownerId || !isSupabaseConfigured) {
      await remoteDeleteQuestionPaper(ownerId, paperId);
      return null;
    }
    return remoteDeleteQuestionPaper(ownerId, paperId);
  };

  const deleteChapter = async (classId, unitId, chapter) => {
    const fileCount = chapter.files?.length || 0;
    const confirmMsg =
      fileCount > 0
        ? `Delete "${chapter.name}" and its ${fileCount} ${
            fileCount === 1 ? "file" : "files"
          }? This cannot be undone.`
        : `Delete "${chapter.name}"?`;
    if (!window.confirm(confirmMsg)) return;

    for (const file of chapter.files || []) {
      const remoteErr = await purgeMaterialFromCloud(file.id);
      if (remoteErr) {
        setMaterialError(`Could not delete "${file.name}" from database: ${remoteErr}`);
        return;
      }
      try {
        await libraryDelete(file.id);
      } catch {
        /* legacy/unknown id */
      }
      try {
        await materialsDelete(file.id);
      } catch {
        /* no metadata yet */
      }
    }
    if (ownerId && isSupabaseConfigured) {
      try {
        await remoteDeleteChapter(ownerId, chapter.id);
      } catch {
        /* remote may be offline */
      }
    }
    setCatalog((prev) =>
      prev.map((classItem) =>
        classItem.id !== classId
          ? classItem
          : {
              ...classItem,
              units: classItem.units.map((unit) =>
                unit.id !== unitId
                  ? unit
                  : {
                      ...unit,
                      chapters: unit.chapters.filter((c) => c.id !== chapter.id),
                    }
              ),
            }
      )
    );
    setSelectedChapterByUnit((prev) =>
      prev[unitId] === chapter.id ? { ...prev, [unitId]: "" } : prev
    );
    setCompiledModal((prev) =>
      prev?.chapter?.id === chapter.id ? null : prev
    );
    setFileWindowModal((prev) =>
      prev?.chapter?.id === chapter.id ? null : prev
    );
  };

  const deleteClass = async (classItem) => {
    const classId = classItem.id;
    let fileCount = 0;
    for (const unit of classItem.units || []) {
      for (const chapter of unit.chapters || []) {
        fileCount += chapter.files?.length || 0;
      }
    }
    const unitIds = (classItem.units || []).map((u) => u.id);
    const confirmMsg =
      fileCount > 0
        ? `Delete "${classItem.name}", all its units, and ${fileCount} ${
            fileCount === 1 ? "file" : "files"
          } from the library? This cannot be undone.`
        : `Delete "${classItem.name}" and all its units? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    for (const unit of classItem.units || []) {
      for (const chapter of unit.chapters || []) {
        for (const file of chapter.files || []) {
          const remoteErr = await purgeMaterialFromCloud(file.id);
          if (remoteErr) {
            setMaterialError(
              `Could not delete "${file.name}" from database: ${remoteErr}`
            );
            return;
          }
          try {
            await libraryDelete(file.id);
          } catch {
            /* legacy/unknown id */
          }
          try {
            await materialsDelete(file.id);
          } catch {
            /* no metadata yet */
          }
        }
      }
    }
    try {
      await remoteDeleteClass(ownerId, classItem.id);
    } catch {
      /* remote may be offline */
    }

    const omitUnitKeys = (prev) => {
      const next = { ...prev };
      for (const id of unitIds) delete next[id];
      return next;
    };

    setCatalog((prev) => prev.filter((c) => c.id !== classId));
    setUnitEditorForClassId((prev) => (prev === classId ? "" : prev));
    setExpandedClassIds((prev) => {
      const next = { ...prev };
      delete next[classId];
      return next;
    });
    setUnitDraftByClass((prev) => {
      const next = { ...prev };
      delete next[classId];
      return next;
    });
    setUnitMarksByClass((prev) => {
      const next = { ...prev };
      delete next[classId];
      return next;
    });
    setChapterEditorForUnitId((prev) => (unitIds.includes(prev) ? "" : prev));
    setMaterialEditorForUnitId((prev) => (unitIds.includes(prev) ? "" : prev));
    setExpandedUnitIds((prev) => {
      const next = { ...prev };
      for (const id of unitIds) delete next[id];
      return next;
    });
    setSelectedChapterByUnit(omitUnitKeys);
    setChapterNameByUnit(omitUnitKeys);
    setDocumentDraftByUnit(omitUnitKeys);
    setDisplayNameByUnit(omitUnitKeys);
    setDriveLinkByUnit(omitUnitKeys);
    setDriveTitleByUnit(omitUnitKeys);
    setCompiledModal((prev) => (prev?.classItem?.id === classId ? null : prev));
    setFileWindowModal((prev) => (prev?.classItem?.id === classId ? null : prev));
    setEditModal((prev) => (prev?.classId === classId ? null : prev));
  };

  const deleteMaterialFile = async (classId, unitId, chapterId, file) => {
    const remoteErr = await purgeMaterialFromCloud(file.id);
    if (remoteErr) {
      setMaterialError(`Could not delete from database: ${remoteErr}`);
      return;
    }
    try {
      await libraryDelete(file.id);
    } catch {
      /* entry may be legacy-only */
    }
    try {
      await materialsDelete(file.id);
    } catch {
      /* no metadata yet */
    }
    removeFileFromCatalog(classId, unitId, chapterId, file.id);
    setFileWindowModal((prev) => (prev?.file.id === file.id ? null : prev));
    setCompiledModal((prev) => {
      if (!prev) return prev;
      if (prev.chapter.id !== chapterId) return prev;
      return {
        ...prev,
        chapter: {
          ...prev.chapter,
          files: prev.chapter.files.filter((f) => f.id !== file.id),
        },
      };
    });
  };

  const openPractiseQuestions = (classItem, unit, chapter) => {
    setVisibleChapterSolutions(new Set());
    setPractiseQuestionsModal({ classItem, unit, chapter });
  };

  const renderChapterMaterialFiles = (classItem, unit, chapter, files, category) => {
    if (!files.length) {
      return <p className="chapter-category-empty">0 files</p>;
    }
    return (
      <>
        <ul className="chapter-sources">
        {files.map((file) => (
          <li key={file.id} className="source-item">
            <div className="source-row-main">
              <button
                type="button"
                className="source-name-btn"
                onClick={() =>
                  setFileWindowModal({
                    kind: "material",
                    classItem,
                    unit,
                    chapter,
                    file: previewFileShape(file),
                  })
                }
              >
                {file.name}
              </button>
              <button
                type="button"
                className="source-action-icon source-action-danger"
                title="Delete"
                aria-label={`Delete ${file.name}`}
                onClick={() =>
                  void deleteMaterialFile(
                    classItem.id,
                    unit.id,
                    chapter.id,
                    file
                  )
                }
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
      </>
    );
  };

  const openEditModal = async (classId, unitId, chapterId, file) => {
    setMaterialError(null);
    if (isTextEditableMaterial(file)) {
      const rec = await libraryGet(file.id);
      if (!rec?.blob) {
        setMaterialError("Could not load this file from the library.");
        return;
      }
      const text = await rec.blob.text();
      setEditText(text);
      setEditModal({ classId, unitId, chapterId, file, mode: "text" });
      return;
    }
    replaceTargetRef.current = { kind: "material", classId, unitId, chapterId, file };
    replaceFileInputRef.current?.click();
  };

  const saveTextEdit = async () => {
    if (!editModal || editModal.mode !== "text") return;
    const { file } = editModal;
    const mime = file.mimeType || "text/plain";
    const blob = new Blob([editText], { type: mime });
    await librarySaveBlob(file.id, blob, { name: file.name, mimeType: mime });
    setCatalog((prev) =>
      prev.map((c) =>
        c.id !== editModal.classId
          ? c
          : {
              ...c,
              units: c.units.map((u) =>
                u.id !== editModal.unitId
                  ? u
                  : {
                      ...u,
                      chapters: u.chapters.map((ch) =>
                        ch.id !== editModal.chapterId
                          ? ch
                          : {
                              ...ch,
                              files: ch.files.map((f) =>
                                f.id === file.id
                                  ? {
                                      ...f,
                                      mimeType: mime,
                                      storedAt: new Date().toISOString(),
                                    }
                                  : f
                              ),
                            }
                      ),
                    }
              ),
            }
      )
    );
    setEditModal(null);
    setEditText("");
  };

  const onReplaceFilePicked = async (event) => {
    const target = replaceTargetRef.current;
    const input = event.target;
    const picked = input.files?.[0];
    input.value = "";
    if (!target || !picked) return;
    const category = getFileCategory(picked);
    if (!category) {
      setMaterialError("This file type is not supported.");
      return;
    }

    if (target.kind === "questionPaper") {
      const { paper } = target;
      const mimeType = picked.type || "application/octet-stream";
      await librarySaveBlob(paper.id, picked, {
        name: paper.name,
        mimeType,
      });
      const updatedPaper = {
        ...paper,
        fileType: category,
        mimeType,
        storedAt: new Date().toISOString(),
      };
      setQuestionBankPapers((prev) =>
        prev.map((p) => (p.id === paper.id ? updatedPaper : p))
      );
      setFileWindowModal((prev) =>
        prev?.kind === "questionPaper" && prev.paper.id === paper.id
          ? {
              ...prev,
              paper: updatedPaper,
              file: previewFileShape({ ...updatedPaper, name: paper.name }),
            }
          : prev
      );
      const blobUrl = URL.createObjectURL(picked);
      setUrlByLibraryId((prev) => {
        const old = prev[paper.id];
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        return { ...prev, [paper.id]: blobUrl };
      });
      if (ownerId) {
        const classItem = catalog.find((c) => c.id === paper.classId);
        const { error: remoteError } = await remoteSaveQuestionPaper(
          ownerId,
          {
            id: paper.id,
            name: paper.name,
            classId: paper.classId,
            paperSource: paper.paperSource,
            year: paper.year,
            fileType: category,
            mimeType,
            source: paper.source,
          },
          picked,
          classItem ? catalog : [{ id: paper.classId, name: paper.className, units: [] }]
        );
        if (remoteError) {
          setMaterialError(
            `File replaced on this device, but cloud sync failed: ${remoteError}`
          );
        }
      }
      replaceTargetRef.current = null;
      return;
    }

    const { classId, unitId, chapterId, file } = target;
    await librarySaveBlob(file.id, picked, {
      name: picked.name,
      mimeType: picked.type || "application/octet-stream",
    });
    setCatalog((prev) =>
      prev.map((c) =>
        c.id !== classId
          ? c
          : {
              ...c,
              units: c.units.map((u) =>
                u.id !== unitId
                  ? u
                  : {
                      ...u,
                      chapters: u.chapters.map((ch) =>
                        ch.id !== chapterId
                          ? ch
                          : {
                              ...ch,
                              files: ch.files.map((f) =>
                                f.id === file.id
                                  ? {
                                      ...f,
                                      name: picked.name,
                                      type: category,
                                      mimeType: picked.type || "application/octet-stream",
                                      storedAt: new Date().toISOString(),
                                    }
                                  : f
                              ),
                            }
                      ),
                    }
              ),
            }
      )
    );
    replaceTargetRef.current = null;
  };

  const createClassFolder = () => {
    const cleanName = classNameInput.trim();
    if (!cleanName) return;

    const newId = `class-${Date.now()}`;
    let appended = false;
    setCatalog((prev) => {
      if (prev.some((c) => c.name === cleanName)) return prev;
      appended = true;
      return [...prev, { id: newId, name: cleanName, units: [] }];
    });
    if (appended) {
      void remoteUpsertClass(ownerId, { id: newId, name: cleanName });
    }
    setExpandedClassIds((prev) => ({ ...prev, [newId]: true }));
    setClassNameInput("");
    setIsCreateClassOpen(false);
  };

  const createUnitFolder = (classId) => {
    const cleanName = (unitDraftByClass[classId] ?? "").trim();
    const marksValue = (unitMarksByClass[classId] ?? "").trim();
    const parsedMarks = marksValue ? Number(marksValue) : null;
    if (!classId || !cleanName) return;

    const newUnitId = `unit-${Date.now()}`;
    let createdUnit = null;
    let position = 0;
    setCatalog((prev) =>
      prev.map((classItem) => {
        if (classItem.id !== classId) return classItem;
        position = classItem.units.length;
        createdUnit = {
          id: newUnitId,
          name: `Unit-${position + 1}`,
          title: cleanName,
          marks: Number.isFinite(parsedMarks) ? parsedMarks : null,
          chapters: [],
        };
        return { ...classItem, units: [...classItem.units, createdUnit] };
      })
    );
    if (createdUnit) {
      void remoteUpsertUnit(ownerId, classId, createdUnit, position);
      setExpandedUnitIds((prev) => ({ ...prev, [newUnitId]: true }));
    }
    setUnitDraftByClass((prev) => ({ ...prev, [classId]: "" }));
    setUnitMarksByClass((prev) => ({ ...prev, [classId]: "" }));
    setUnitEditorForClassId("");
  };

  const createChapterFolder = (classId, unitId) => {
    const cleanName = (chapterNameByUnit[unitId] ?? "").trim();
    if (!classId || !unitId || !cleanName) return;

    const newChapterId = `chapter-${Date.now()}`;
    let createdChapter = null;
    let position = 0;
    setCatalog((prev) =>
      prev.map((classItem) =>
        classItem.id !== classId
          ? classItem
          : {
              ...classItem,
              units: classItem.units.map((unit) => {
                if (unit.id !== unitId) return unit;
                position = unit.chapters.length;
                createdChapter = {
                  id: newChapterId,
                  name: `Chapter-${position + 1}: ${cleanName}`,
                  files: [],
                };
                return { ...unit, chapters: [...unit.chapters, createdChapter] };
              }),
            }
      )
    );
    if (createdChapter) {
      void remoteUpsertChapter(ownerId, classId, unitId, createdChapter, position);
    }
    setChapterNameByUnit((prev) => ({ ...prev, [unitId]: "" }));
    setChapterEditorForUnitId("");
  };

  const getFileCategory = (file) => {
    const name = file.name.toLowerCase();
    const mime = file.type;
    if (mime.startsWith("text/")) return "Text";
    if (mime.startsWith("image/")) return "Image";
    if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
    if (
      mime.includes("word") ||
      mime.includes("officedocument.wordprocessingml.document") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    ) {
      return "Microsoft Document";
    }
    if (name.endsWith(".gdoc")) return "Google Doc";
    return null;
  };

  const uploadLocalFiles = async (classId, unitId, chapterId, event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!classId || !unitId || !chapterId || files.length === 0) return;
    setMaterialError(null);
    setImportBusy(true);
    try {
      const requestedName = (displayNameByUnit[unitId] ?? "").trim();
      const entries = [];
      for (const [index, file] of files.entries()) {
        const category = getFileCategory(file);
        if (!category) continue;
        const id = newLibraryId();
        let finalName = file.name;
        if (requestedName) {
          finalName = files.length === 1 ? requestedName : `${requestedName} ${index + 1}`;
        }
        const mimeType = file.type || "application/octet-stream";
        await librarySaveBlob(id, file, { name: finalName, mimeType });
        entries.push({
          id,
          name: finalName,
          type: category,
          mimeType,
          storedAt: new Date().toISOString(),
        });
        await persistMaterialRecord(
          {
            id,
            name: finalName,
            classId,
            unitId,
            chapterId,
            materialCategory: DEFAULT_MATERIAL_CATEGORY,
            fileType: category,
            mimeType,
            source: { kind: "local", origin: file.name },
          },
          file
        );
      }
      if (entries.length === 0) {
        setMaterialError("No supported files in this selection.");
        return;
      }
      setCatalog((prev) =>
        prev.map((classItem) =>
          classItem.id !== classId
            ? classItem
            : {
                ...classItem,
                units: classItem.units.map((unit) =>
                  unit.id !== unitId
                    ? unit
                    : {
                        ...unit,
                        chapters: unit.chapters.map((chapter) =>
                          chapter.id !== chapterId
                            ? chapter
                            : { ...chapter, files: [...chapter.files, ...entries] }
                        ),
                      }
                ),
              }
        )
      );
      setDisplayNameByUnit((prev) => ({ ...prev, [unitId]: "" }));
    } catch (err) {
      setMaterialError(err.message || "Could not save files to the library.");
    } finally {
      setImportBusy(false);
    }
  };

  const addDriveFile = async (classId, unitId, chapterId) => {
    const link = (driveLinkByUnit[unitId] ?? "").trim();
    const title = (displayNameByUnit[unitId] ?? driveTitleByUnit[unitId] ?? "").trim();
    if (!classId || !unitId || !chapterId || !link) return;
    setMaterialError(null);
    setImportBusy(true);
    try {
      const blob = await fetchDriveLinkAsBlob(link);
      const id = newLibraryId();
      const baseName = title || "library-import";
      const ext = guessExtFromMime(blob.type);
      const name = baseName.includes(".") ? baseName : `${baseName}.${ext}`;
      const category = categoryFromBlob(blob, name);
      await librarySaveBlob(id, blob, {
        name,
        mimeType: blob.type || "application/octet-stream",
      });
      const entry = {
        id,
        name,
        type: category,
        mimeType: blob.type || "application/octet-stream",
        storedAt: new Date().toISOString(),
      };
      setCatalog((prev) =>
        prev.map((classItem) =>
          classItem.id !== classId
            ? classItem
            : {
                ...classItem,
                units: classItem.units.map((unit) =>
                  unit.id !== unitId
                    ? unit
                    : {
                        ...unit,
                        chapters: unit.chapters.map((chapter) =>
                          chapter.id !== chapterId
                            ? chapter
                            : { ...chapter, files: [...chapter.files, entry] }
                        ),
                      }
                ),
              }
        )
      );
      await persistMaterialRecord(
        {
          id,
          name,
          classId,
          unitId,
          chapterId,
          materialCategory: DEFAULT_MATERIAL_CATEGORY,
          fileType: category,
          mimeType: blob.type || "application/octet-stream",
          source: { kind: "drive", origin: link },
        },
        blob
      );
      setDriveLinkByUnit((prev) => ({ ...prev, [unitId]: "" }));
      setDriveTitleByUnit((prev) => ({ ...prev, [unitId]: "" }));
      setDisplayNameByUnit((prev) => ({ ...prev, [unitId]: "" }));
    } catch (err) {
      setMaterialError(err.message || "Could not import from Drive. Upload the file locally instead.");
    } finally {
      setImportBusy(false);
    }
  };

  const downloadCompiledHtml = async () => {
    if (!compiledModal) return;
    const { classItem, unit, chapter } = compiledModal;
    try {
      const enriched = await Promise.all(
        chapter.files.map(async (f) => {
          const rec = await libraryGet(f.id);
          if (rec?.blob) {
            const exportHref = await blobToDataUrl(rec.blob);
            return { ...f, exportHref };
          }
          return { ...f, exportHref: hrefFor(f) || "#" };
        })
      );
      const html = buildCompiledHtmlDocument({
        className: classItem.name,
        unitName: unit.name,
        unitTitle: unit.title,
        chapterName: chapter.name,
        files: enriched,
      });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${chapter.name.replace(/[/\\?%*:|"<>]/g, "-")}-compiled.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMaterialError(err.message || "Could not build download.");
    }
  };

  const addQuestionBankSet = () => {
    const cleanName = questionBankInput.trim();
    if (!cleanName) return;
    setQuestionBankSets((prev) => [...prev, { id: `qb-${Date.now()}`, name: cleanName }]);
    setQuestionBankInput("");
  };

  const cancelQuestionPaperDraft = () => {
    questionPaperPickRef.current = false;
    setQuestionPaperDraft(null);
  };

  const toggleQuestionPaperEditor = () => {
    setQuestionPaperEditorOpen((open) => {
      if (open) {
        cancelQuestionPaperDraft();
        return false;
      }
      setQuestionPaperDraft(emptyQuestionPaperDraft());
      return true;
    });
  };

  const setQuestionPaperField = (patch) => {
    setQuestionPaperDraft((prev) => ({ ...(prev || emptyQuestionPaperDraft()), ...patch }));
  };

  const triggerQuestionPaperLocalPicker = () => {
    questionPaperPickRef.current = true;
    requestAnimationFrame(() => questionPaperLocalInputRef.current?.click());
  };

  const onQuestionPaperLocalFilePicked = (event) => {
    if (!questionPaperPickRef.current) return;
    questionPaperPickRef.current = false;
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setQuestionPaperDraft((prev) => ({
      ...(prev || emptyQuestionPaperDraft()),
      step: "local",
      file,
      displayName: (prev?.displayName || "").trim() || file.name,
    }));
  };

  const renderQuestionPaperMetaFields = (draft, { disableFileFields = false } = {}) => (
    <>
      <div
        className="document-category"
        role="group"
        aria-label="Question paper source"
      >
        <span className="document-category-label">Source</span>
        <div className="document-category-options">
          {QUESTION_PAPER_SOURCES.map((src) => (
            <label key={src} className="category-option">
              <input
                type="radio"
                name="qb-paper-source"
                value={src}
                checked={(draft.paperSource || DEFAULT_QUESTION_PAPER_SOURCE) === src}
                onChange={() => setQuestionPaperField({ paperSource: src })}
                disabled={disableFileFields}
              />
              <span>{src}</span>
            </label>
          ))}
          <label className="category-option category-option-year">
            <span>Year</span>
            <select
              value={draft.year ?? String(new Date().getFullYear())}
              onChange={(e) => setQuestionPaperField({ year: e.target.value })}
              disabled={disableFileFields}
            >
              {questionPaperYearOptions().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  );

  const saveQuestionPaperUpload = async () => {
    const draft = questionPaperDraft;
    if (!draft?.classId) {
      setMaterialError("Select a class for this question paper.");
      return;
    }
    const classItem = catalog.find((c) => c.id === draft.classId);
    if (!classItem) {
      setMaterialError("Selected class was not found.");
      return;
    }
    setMaterialError(null);
    setImportBusy(true);
    try {
      let blob = null;
      let name = "";
      let fileType = "";
      let mimeType = "";
      let source = null;

      if (draft.step === "local") {
        const file = draft.file;
        if (!file) {
          setMaterialError("Choose a file to upload.");
          return;
        }
        const category = getFileCategory(file);
        if (!category) {
          setMaterialError("This file type is not supported.");
          return;
        }
        blob = file;
        name = (draft.displayName || "").trim() || file.name;
        fileType = category;
        mimeType = file.type || "application/octet-stream";
        source = { kind: "local", origin: file.name };
      } else if (draft.step === "drive") {
        const link = (draft.link || "").trim();
        if (!link) {
          setMaterialError("Paste a Google Drive link.");
          return;
        }
        blob = await fetchDriveLinkAsBlob(link);
        const baseName = (draft.displayName || "").trim() || "question-paper";
        const ext = guessExtFromMime(blob.type);
        name = baseName.includes(".") ? baseName : `${baseName}.${ext}`;
        fileType = categoryFromBlob(blob, name);
        mimeType = blob.type || "application/octet-stream";
        source = { kind: "drive", origin: link };
      } else {
        setMaterialError("Choose local file or Google Drive.");
        return;
      }

      const id = newLibraryId();
      await librarySaveBlob(id, blob, { name, mimeType });

      const paper = {
        id,
        name,
        classId: draft.classId,
        className: classItem.name,
        paperSource: draft.paperSource || DEFAULT_QUESTION_PAPER_SOURCE,
        year: Number(draft.year) || new Date().getFullYear(),
        fileType,
        mimeType,
        source,
        storedAt: new Date().toISOString(),
      };

      const { error: remoteError } = await remoteSaveQuestionPaper(
        ownerId,
        {
          id,
          name,
          classId: draft.classId,
          paperSource: paper.paperSource,
          year: paper.year,
          fileType,
          mimeType,
          source,
        },
        blob,
        catalog
      );

      setQuestionBankPapers((prev) => [paper, ...prev]);
      setQuestionPaperEditorOpen(false);
      cancelQuestionPaperDraft();

      if (remoteError) {
        setMaterialError(
          `Saved on this device, but cloud sync failed: ${remoteError}`
        );
      }

      setLibraryNotice(null);
      const sync = await syncQuestionBankFromQuestionPaper(ownerId, paper, blob, {
        remoteOk: !remoteError,
        catalog,
        normalizeMaterialCategory,
        remoteDownloadMaterial: remoteDownloadMaterialBlob,
      });
      await refreshQuestionBankEntries();
      if (sync.error) {
        setMaterialError(
          `Paper saved, but question bank update failed: ${sync.error}`
        );
      } else if (sync.count > 0) {
        const assigned = sync.assignedCount ?? 0;
        const chapterNote =
          assigned > 0
            ? `; ${assigned} assigned to chapters (${sync.classifiedBy})`
            : import.meta.env.VITE_OPENAI_API_KEY
              ? ". Add syllabus PDFs per chapter to improve chapter matching"
              : ". Set VITE_OPENAI_API_KEY for AI extraction and classification; add syllabus PDFs per chapter";
        const dbNote = sync.error ? "" : " Saved to question bank.";
        setLibraryNotice(
          `Added ${sync.count} question${sync.count === 1 ? "" : "s"} (${sync.extractedBy})${chapterNote}.${dbNote}`
        );
      } else if (sync.count === 0 && !sync.error) {
        setLibraryNotice(
          "Paper saved. No questions could be read from this file yet — set VITE_OPENAI_API_KEY in .env.local for AI extraction."
        );
      }
    } catch (err) {
      setMaterialError(err.message || "Could not save question paper.");
    } finally {
      setImportBusy(false);
    }
  };

  const reextractQuestionPaper = async (paper) => {
    if (!ownerId) {
      setMaterialError("Sign in to extract questions.");
      return;
    }
    setMaterialError(null);
    setClassifyingBusy(true);
    try {
      const sync = await reprocessQuestionPaper(ownerId, paper, catalog, {
        ...questionBankBlobOptions,
        normalizeMaterialCategory,
        remoteDownloadMaterial: remoteDownloadMaterialBlob,
      });
      await refreshQuestionBankEntries();
      if (sync.error) {
        setMaterialError(`Re-extract failed for "${paper.name}": ${sync.error}`);
      } else if (sync.count > 0) {
        setLibraryNotice(
          `Re-extracted ${sync.count} question${sync.count === 1 ? "" : "s"} from "${paper.name}" (${sync.extractedBy}).`
        );
      } else {
        setMaterialError(
          `No questions could be read from "${paper.name}". Set VITE_OPENAI_API_KEY in .env.local for AI extraction.`
        );
      }
    } catch (err) {
      setMaterialError(err.message || "Could not re-extract questions.");
    } finally {
      setClassifyingBusy(false);
    }
  };

  const deleteQuestionPaper = async (paper) => {
    const confirmMsg = `Delete "${paper.name}"? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const remoteErr = await purgeQuestionPaperFromCloud(paper.id);
    if (remoteErr) {
      setMaterialError(`Could not delete question paper from database: ${remoteErr}`);
      return;
    }
    try {
      await libraryDelete(paper.id);
    } catch {
      /* may not exist locally */
    }
    setQuestionBankPapers((prev) => prev.filter((p) => p.id !== paper.id));
    setFileWindowModal((prev) =>
      prev?.file?.id === paper.id ? null : prev
    );
    setUrlByLibraryId((prev) => {
      const next = { ...prev };
      delete next[paper.id];
      return next;
    });
  };

  const toggleChapterEditor = (unitId) => {
    setChapterEditorForUnitId((prev) => {
      const next = prev === unitId ? "" : unitId;
      if (next) {
        setMaterialEditorForUnitId("");
        ensureUnitExpanded(unitId);
      }
      return next;
    });
  };

  const toggleMaterialEditor = (unitId) => {
    setMaterialEditorForUnitId((prev) => {
      const next = prev === unitId ? "" : unitId;
      if (next) {
        setChapterEditorForUnitId("");
        ensureUnitExpanded(unitId);
      } else {
        cancelDocumentDraft(unitId);
      }
      return next;
    });
  };

  return (
    <main className="studio materials-page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span className="brand-name">Enlightly</span>
        </div>
        <div className="topbar-actions">
          <button className="signout-btn" type="button" onClick={onSignOut}>
            Sign out
          </button>
          <button className="avatar" type="button" onClick={() => navigateTo("/dashboard")}>
            LY
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">RESOURCE LIBRARY</p>
        <h1>Materials folder</h1>
        <p className="subtext">
          Create Class folders, add Units, then Chapters. Each upload is stored as a library copy in
          your browser—view, edit, or delete from there.
        </p>
      </section>

      {libraryHydrating ? (
        <p className="auth-hint" role="status">
          Loading your library from the cloud…
        </p>
      ) : null}

      {libraryNotice ? (
        <p className="auth-success" role="status">
          {libraryNotice}
        </p>
      ) : null}

      {materialError ? (
        <p className="material-error" role="alert">
          {materialError}
        </p>
      ) : null}

      <input
        ref={replaceFileInputRef}
        type="file"
        className="visually-hidden"
        aria-hidden
        tabIndex={-1}
        accept="image/*,.pdf,.doc,.docx,.gdoc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
        onChange={onReplaceFilePicked}
      />

      <input
        ref={materialLocalPickInputRef}
        type="file"
        className="visually-hidden"
        aria-hidden
        tabIndex={-1}
        accept={MATERIAL_LOCAL_FILE_ACCEPT}
        onChange={onMaterialLocalFilePicked}
      />

      <input
        ref={questionPaperLocalInputRef}
        type="file"
        className="visually-hidden"
        aria-hidden
        tabIndex={-1}
        accept={MATERIAL_LOCAL_FILE_ACCEPT}
        onChange={onQuestionPaperLocalFilePicked}
      />

      <section className="materials-layout">
        <article className="material-folder material-folder--teaching">
          <div className="folder-head">
            <h2>Teaching Materials</h2>
            <button
              type="button"
              className="create-class-btn"
              onClick={() => setIsCreateClassOpen(true)}
            >
              + Add Class
            </button>
          </div>

          <div className="folder-controls">
            {isCreateClassOpen && (
              <div
                className="modal-backdrop"
                role="presentation"
                onClick={() => setIsCreateClassOpen(false)}
              >
                <div
                  className="class-modal"
                  role="dialog"
                  aria-modal="true"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3>Create Class</h3>
                  <input
                    type="text"
                    placeholder="Enter class name (e.g. Class XII)"
                    value={classNameInput}
                    onChange={(e) => setClassNameInput(e.target.value)}
                  />
                  <div className="class-modal-actions">
                    <button type="button" onClick={() => setIsCreateClassOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" onClick={createClassFolder}>
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {catalog.length === 0 ? (
            <p className="empty-state">
              No teaching materials yet. Create a Class folder, then add Units and Chapters.
            </p>
          ) : (
            catalog.map((classItem) => (
              <div key={classItem.id} className="class-block">
                <div className="class-header">
                  <button
                    type="button"
                    className="class-toggle"
                    onClick={() => toggleClassExpanded(classItem.id)}
                    aria-expanded={isClassExpanded(classItem.id)}
                    aria-controls={`class-panel-${classItem.id}`}
                  >
                    <span
                      className={`class-chevron${
                        isClassExpanded(classItem.id) ? "" : " collapsed"
                      }`}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                    <span className="class-title">{classItem.name}</span>
                  </button>
                  <div className="class-header-actions">
                    <button
                      type="button"
                      className="add-chapter-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isClassExpanded(classItem.id)) {
                          setExpandedClassIds((prev) => ({
                            ...prev,
                            [classItem.id]: true,
                          }));
                        }
                        setUnitEditorForClassId((p) =>
                          p === classItem.id ? "" : classItem.id
                        );
                      }}
                    >
                      {unitEditorForClassId === classItem.id ? "Cancel" : "+ Add Unit"}
                    </button>
                    <button
                      type="button"
                      className="source-action-icon source-action-danger class-delete-btn"
                      title="Delete class"
                      aria-label={`Delete class ${classItem.name}`}
                      onClick={() => void deleteClass(classItem)}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {isClassExpanded(classItem.id) && (
                <div className="class-panel" id={`class-panel-${classItem.id}`}>
                {unitEditorForClassId === classItem.id && (
                  <div className="inline-form class-chapter-form">
                    <input
                      type="text"
                      placeholder={`Unit title in ${classItem.name}`}
                      value={unitDraftByClass[classItem.id] ?? ""}
                      onChange={(e) =>
                        setUnitDraftByClass((prev) => ({
                          ...prev,
                          [classItem.id]: e.target.value,
                        }))
                      }
                    />
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Marks (optional)"
                      value={unitMarksByClass[classItem.id] ?? ""}
                      onChange={(e) =>
                        setUnitMarksByClass((prev) => ({
                          ...prev,
                          [classItem.id]: e.target.value,
                        }))
                      }
                    />
                    <button type="button" onClick={() => createUnitFolder(classItem.id)}>
                      Save Unit
                    </button>
                  </div>
                )}

                {classItem.units.length === 0 ? (
                  <p className="inline-muted">No units yet.</p>
                ) : (
                  <div className="class-units-grid">
                  {classItem.units.map((unit) => (
                    <div key={unit.id} className="unit-block">
                      <div className="unit-header">
                        <button
                          type="button"
                          className="unit-toggle"
                          onClick={() => toggleUnitExpanded(unit.id)}
                          aria-expanded={isUnitExpanded(unit.id)}
                          aria-controls={`unit-panel-${unit.id}`}
                        >
                          <span
                            className={`unit-chevron${
                              isUnitExpanded(unit.id) ? "" : " collapsed"
                            }`}
                            aria-hidden="true"
                          >
                            ▾
                          </span>
                          <span className="unit-name">
                            {unit.name} - {unit.title}
                          </span>
                        </button>
                        <div className="unit-marks-wrap">
                          {unit.marks != null && unit.marks !== "" ? (
                            <span className="unit-marks">{unit.marks} marks</span>
                          ) : null}
                        </div>
                      </div>

                      {isUnitExpanded(unit.id) ? (
                      <>
                      <div className="unit-body" id={`unit-panel-${unit.id}`}>
                        {chapterEditorForUnitId === unit.id && (
                          <div className="inline-form class-chapter-form">
                            <input
                              type="text"
                              placeholder="Enter chapter name"
                              value={chapterNameByUnit[unit.id] ?? ""}
                              onChange={(e) =>
                                setChapterNameByUnit((prev) => ({
                                  ...prev,
                                  [unit.id]: e.target.value,
                                }))
                              }
                            />
                            <button type="button" onClick={() => setChapterEditorForUnitId("")}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => createChapterFolder(classItem.id, unit.id)}
                            >
                              Save Chapter
                            </button>
                          </div>
                        )}

                        {materialEditorForUnitId === unit.id && (
                          <div className="unit-material-editor">
                            {(() => {
                              const draft = documentDraftByUnit[unit.id];
                              const chapterId = selectedChapterByUnit[unit.id];
                              const step = draft?.step ?? "choose";

                              const chapterSelect = (
                                <div className="inline-form material-chapter-select">
                                  <label className="document-field">
                                    <span>Chapter</span>
                                    <select
                                      value={chapterId ?? ""}
                                      onChange={(e) =>
                                        setSelectedChapterByUnit((prev) => ({
                                          ...prev,
                                          [unit.id]: e.target.value,
                                        }))
                                      }
                                      disabled={!unit.chapters.length}
                                    >
                                      <option value="">Select chapter</option>
                                      {unit.chapters.map((chapter) => (
                                        <option key={chapter.id} value={chapter.id}>
                                          {chapter.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  {!unit.chapters.length ? (
                                    <span className="inline-muted">
                                      No chapters yet. Use +Chapter to add one.
                                    </span>
                                  ) : null}
                                </div>
                              );

                              if (step === "choose") {
                                return (
                                  <div className="document-source-choice">
                                    <button
                                      type="button"
                                      className="document-choice-btn"
                                      onClick={() => {
                                        materialPickUnitRef.current = null;
                                        setDocumentDraftByUnit((prev) => ({
                                          ...prev,
                                          [unit.id]: {
                                            step: "drive",
                                            file: null,
                                            link: "",
                                            displayName: "",
                                            materialCategory: DEFAULT_MATERIAL_CATEGORY,
                                            examSource: DEFAULT_EXAM_SOURCE,
                                          },
                                        }));
                                      }}
                                    >
                                      Add from Google Drive
                                    </button>
                                    <button
                                      type="button"
                                      className="document-choice-btn"
                                      onClick={() => triggerMaterialLocalPicker(unit.id)}
                                    >
                                      Choose file from local
                                    </button>
                                  </div>
                                );
                              }
                              if (draft.step === "drive") {
                                const canSave =
                                  !!(draft.link || "").trim() &&
                                  !!chapterId &&
                                  !importBusy;
                                return (
                                  <div className="document-form">
                                    {chapterSelect}
                                    <label className="document-field">
                                      <span>Google Drive link</span>
                                      <input
                                        type="url"
                                        placeholder="Paste Google Drive link"
                                        value={draft.link || ""}
                                        onChange={(e) =>
                                          setDraftField(unit.id, {
                                            link: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="document-field">
                                      <span>Display name</span>
                                      <input
                                        type="text"
                                        placeholder="Rename the file"
                                        value={draft.displayName || ""}
                                        onChange={(e) =>
                                          setDraftField(unit.id, {
                                            displayName: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <div
                                      className="document-category"
                                      role="group"
                                      aria-labelledby={`material-cat-label-${unit.id}`}
                                    >
                                      <span
                                        className="document-category-label"
                                        id={`material-cat-label-${unit.id}`}
                                      >
                                        Material Type
                                      </span>
                                      <div className="document-category-options">
                                        {MATERIAL_CATEGORIES.map((cat) => (
                                          <label
                                            key={cat}
                                            className="category-option"
                                          >
                                            <input
                                              type="radio"
                                              name={`material-cat-${unit.id}`}
                                              value={cat}
                                              checked={
                                                (draft.materialCategory ||
                                                  DEFAULT_MATERIAL_CATEGORY) === cat
                                              }
                                              onChange={() =>
                                                setDraftField(unit.id, {
                                                  materialCategory: cat,
                                                })
                                              }
                                            />
                                            <span>{cat}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                    {(draft.materialCategory ||
                                      DEFAULT_MATERIAL_CATEGORY) ===
                                    "Question papers" ? (
                                      <div
                                        className="document-category"
                                        role="group"
                                        aria-label="Question paper source"
                                      >
                                        <span className="document-category-label">
                                          Source
                                        </span>
                                        <div className="document-category-options">
                                          {EXAM_SOURCES.map((src) => (
                                            <label
                                              key={src}
                                              className="category-option"
                                            >
                                              <input
                                                type="radio"
                                                name={`exam-src-${unit.id}`}
                                                value={src}
                                                checked={
                                                  normalizeExamSource(
                                                    draft.examSource
                                                  ) === src
                                                }
                                                onChange={() =>
                                                  setDraftField(unit.id, {
                                                    examSource: src,
                                                  })
                                                }
                                              />
                                              <span>{src}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                    <div className="document-form-actions">
                                      <button
                                        type="button"
                                        className="document-cancel-btn"
                                        onClick={() => {
                                          materialPickUnitRef.current = null;
                                          setDocumentDraftByUnit((prev) => ({
                                            ...prev,
                                            [unit.id]: {
                                              step: "choose",
                                              file: null,
                                              link: "",
                                              displayName: "",
                                              materialCategory: DEFAULT_MATERIAL_CATEGORY,
                                              examSource: DEFAULT_EXAM_SOURCE,
                                            },
                                          }));
                                        }}
                                      >
                                        Back
                                      </button>
                                      <button
                                        type="button"
                                        className="document-save-btn"
                                        disabled={!canSave}
                                        onClick={() =>
                                          void saveDocumentDraft(
                                            classItem.id,
                                            unit.id,
                                            chapterId
                                          )
                                        }
                                      >
                                        {importBusy ? "Saving…" : "Save"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              if (draft.step === "local") {
                                const canSave =
                                  !!draft.file && !!chapterId && !importBusy;
                                return (
                                  <div className="document-form">
                                    {chapterSelect}
                                    {draft.file ? (
                                      <p className="material-selected-file">
                                        <span className="material-selected-name">
                                          {draft.file.name}
                                        </span>
                                        <button
                                          type="button"
                                          className="material-change-file-btn"
                                          onClick={() => triggerMaterialLocalPicker(unit.id)}
                                        >
                                          Change file
                                        </button>
                                      </p>
                                    ) : null}
                                    <label className="document-field">
                                      <span>Display name</span>
                                      <input
                                        type="text"
                                        placeholder="Rename the file"
                                        value={draft.displayName || ""}
                                        onChange={(e) =>
                                          setDraftField(unit.id, {
                                            displayName: e.target.value,
                                          })
                                        }
                                        disabled={!draft.file}
                                      />
                                    </label>
                                    <div
                                      className="document-category"
                                      role="group"
                                      aria-labelledby={`material-cat-label-${unit.id}`}
                                    >
                                      <span
                                        className="document-category-label"
                                        id={`material-cat-label-${unit.id}`}
                                      >
                                        Material Type
                                      </span>
                                      <div className="document-category-options">
                                        {MATERIAL_CATEGORIES.map((cat) => (
                                          <label
                                            key={cat}
                                            className="category-option"
                                          >
                                            <input
                                              type="radio"
                                              name={`material-cat-${unit.id}`}
                                              value={cat}
                                              checked={
                                                (draft.materialCategory ||
                                                  DEFAULT_MATERIAL_CATEGORY) ===
                                                cat
                                              }
                                              onChange={() =>
                                                setDraftField(unit.id, {
                                                  materialCategory: cat,
                                                })
                                              }
                                              disabled={!draft.file}
                                            />
                                            <span>{cat}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                    {(draft.materialCategory ||
                                      DEFAULT_MATERIAL_CATEGORY) ===
                                    "Question papers" ? (
                                      <div
                                        className="document-category"
                                        role="group"
                                        aria-label="Question paper source"
                                      >
                                        <span className="document-category-label">
                                          Source
                                        </span>
                                        <div className="document-category-options">
                                          {EXAM_SOURCES.map((src) => (
                                            <label
                                              key={src}
                                              className="category-option"
                                            >
                                              <input
                                                type="radio"
                                                name={`exam-src-${unit.id}`}
                                                value={src}
                                                checked={
                                                  normalizeExamSource(
                                                    draft.examSource
                                                  ) === src
                                                }
                                                onChange={() =>
                                                  setDraftField(unit.id, {
                                                    examSource: src,
                                                  })
                                                }
                                                disabled={!draft.file}
                                              />
                                              <span>{src}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                    <div className="document-form-actions">
                                      <button
                                        type="button"
                                        className="document-cancel-btn"
                                        onClick={() => {
                                          materialPickUnitRef.current = null;
                                          setDocumentDraftByUnit((prev) => ({
                                            ...prev,
                                            [unit.id]: {
                                              step: "choose",
                                              file: null,
                                              link: "",
                                              displayName: "",
                                              materialCategory: DEFAULT_MATERIAL_CATEGORY,
                                              examSource: DEFAULT_EXAM_SOURCE,
                                            },
                                          }));
                                        }}
                                      >
                                        Back
                                      </button>
                                      <button
                                        type="button"
                                        className="document-save-btn"
                                        disabled={!canSave}
                                        onClick={() =>
                                          void saveDocumentDraft(
                                            classItem.id,
                                            unit.id,
                                            chapterId
                                          )
                                        }
                                      >
                                        {importBusy ? "Saving…" : "Save"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}

                        {unit.chapters.length === 0 ? (
                          <p className="inline-muted">No chapters yet.</p>
                        ) : (
                          <ul className="chapter-list">
                            {unit.chapters.map((chapter) => {
                              const filesForCategory = (category) =>
                                chapter.files.filter(
                                  (f) => normalizeMaterialCategory(f) === category
                                );
                              const syllabusFiles = filesForCategory("Syllabus");
                              const chapterBankCount = questionsByChapter(
                                questionBankEntries,
                                chapter.id
                              ).length;

                              return (
                                <li key={chapter.id} className="chapter-row">
                                  <div className="chapter-row-head">
                                    <button
                                      type="button"
                                      className="chapter-link"
                                      onClick={() =>
                                        setCompiledModal({ classItem, unit, chapter })
                                      }
                                    >
                                      {chapter.name}
                                    </button>
                                    <button
                                      type="button"
                                      className="source-action-icon source-action-danger chapter-delete-btn"
                                      title="Delete chapter"
                                      aria-label={`Delete chapter ${chapter.name}`}
                                      onClick={() =>
                                        void deleteChapter(
                                          classItem.id,
                                          unit.id,
                                          chapter
                                        )
                                      }
                                    >
                                      🗑
                                    </button>
                                  </div>
                                  <div className="chapter-materials-layout">
                                    <div className="chapter-materials-col chapter-materials-col--left">
                                      <div className="chapter-category-group">
                                        <h5 className="chapter-category-heading">
                                          Syllabus
                                        </h5>
                                        {renderChapterMaterialFiles(
                                          classItem,
                                          unit,
                                          chapter,
                                          syllabusFiles,
                                          "Syllabus"
                                        )}
                                      </div>
                                      {CHAPTER_MATERIAL_LEFT.map((category) => (
                                        <div
                                          key={category}
                                          className="chapter-category-group"
                                        >
                                          <h5 className="chapter-category-heading">
                                            {category}
                                          </h5>
                                          {renderChapterMaterialFiles(
                                            classItem,
                                            unit,
                                            chapter,
                                            filesForCategory(category),
                                            category
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                    <div className="chapter-materials-col chapter-materials-col--right">
                                      {CHAPTER_MATERIAL_RIGHT.map((category) => (
                                        <div
                                          key={category}
                                          className="chapter-category-group"
                                        >
                                          <h5 className="chapter-category-heading">
                                            {category}
                                          </h5>
                                          {renderChapterMaterialFiles(
                                            classItem,
                                            unit,
                                            chapter,
                                            filesForCategory(category),
                                            category
                                          )}
                                          {category === "Question papers" ? (
                                            <button
                                              type="button"
                                              className="practise-questions-link"
                                              onClick={() =>
                                                openPractiseQuestions(
                                                  classItem,
                                                  unit,
                                                  chapter
                                                )
                                              }
                                            >
                                              Practise questions
                                              {chapterBankCount > 0
                                                ? ` (${chapterBankCount})`
                                                : ""}
                                            </button>
                                          ) : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <div className="unit-footer">
                        <button
                          type="button"
                          className="unit-action-btn"
                          onClick={() => toggleChapterEditor(unit.id)}
                        >
                          {chapterEditorForUnitId === unit.id ? "Cancel" : "+Chapter"}
                        </button>
                        <button
                          type="button"
                          className="unit-action-btn"
                          onClick={() => toggleMaterialEditor(unit.id)}
                        >
                          {materialEditorForUnitId === unit.id ? "Cancel" : "+Material"}
                        </button>
                      </div>
                      </>
                      ) : null}
                    </div>
                  ))}
                  </div>
                )}
                </div>
                )}
              </div>
            ))
          )}
        </article>

        <article className="material-folder material-folder--question-bank">
          <div className="folder-head">
            <h2>Question Bank</h2>
            <div className="folder-head-actions">
              <button
                type="button"
                className="create-class-btn"
                onClick={toggleQuestionPaperEditor}
              >
                {questionPaperEditorOpen ? "Cancel" : "+ Question Papers"}
              </button>
            </div>
          </div>
          <p className="auth-hint question-bank-hint">
            Upload exam papers here. Each paper is saved to the database, questions are extracted
            (with marks and solutions when present), and classified to chapters. Add syllabus PDFs
            under each chapter for best classification. View questions per chapter via{" "}
            <em>Practise questions</em>. Set <code>VITE_OPENAI_API_KEY</code> in{" "}
            <code>.env.local</code> for AI extraction and classification.
          </p>

          {questionPaperEditorOpen && questionPaperDraft ? (
            <div className="unit-material-editor question-paper-editor">
              <div className="inline-form">
                <select
                  value={questionPaperDraft.classId}
                  onChange={(e) =>
                    setQuestionPaperField({
                      classId: e.target.value,
                      step: "choose",
                      file: null,
                      link: "",
                    })
                  }
                >
                  <option value="">Select class</option>
                  {catalog.map((classItem) => (
                    <option key={classItem.id} value={classItem.id}>
                      {classItem.name}
                    </option>
                  ))}
                </select>
              </div>

              {!questionPaperDraft.classId ? (
                <span className="inline-muted">Select a class to add a question paper.</span>
              ) : questionPaperDraft.step === "choose" ? (
                <div className="document-source-choice">
                  <button
                    type="button"
                    className="document-choice-btn"
                    onClick={() =>
                      setQuestionPaperField({
                        step: "drive",
                        file: null,
                        link: "",
                        displayName: "",
                      })
                    }
                  >
                    Add from Google Drive
                  </button>
                  <button
                    type="button"
                    className="document-choice-btn"
                    onClick={triggerQuestionPaperLocalPicker}
                  >
                    Choose file from local
                  </button>
                </div>
              ) : questionPaperDraft.step === "drive" ? (
                <div className="document-form">
                  <label className="document-field">
                    <span>Google Drive link</span>
                    <input
                      type="url"
                      placeholder="Paste Google Drive link"
                      value={questionPaperDraft.link || ""}
                      onChange={(e) => setQuestionPaperField({ link: e.target.value })}
                    />
                  </label>
                  <label className="document-field">
                    <span>Display name</span>
                    <input
                      type="text"
                      placeholder="Rename the file"
                      value={questionPaperDraft.displayName || ""}
                      onChange={(e) =>
                        setQuestionPaperField({ displayName: e.target.value })
                      }
                    />
                  </label>
                  {renderQuestionPaperMetaFields(questionPaperDraft)}
                  <div className="document-form-actions">
                    <button
                      type="button"
                      className="document-cancel-btn"
                      onClick={() =>
                        setQuestionPaperField({
                          step: "choose",
                          file: null,
                          link: "",
                          displayName: "",
                        })
                      }
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="document-save-btn"
                      disabled={!(questionPaperDraft.link || "").trim() || importBusy}
                      onClick={() => void saveQuestionPaperUpload()}
                    >
                      {importBusy ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : questionPaperDraft.step === "local" ? (
                <div className="document-form">
                  <p className="inline-muted">
                    File: {questionPaperDraft.file?.name || "—"}
                  </p>
                  <label className="document-field">
                    <span>Display name</span>
                    <input
                      type="text"
                      placeholder="Rename the file"
                      value={questionPaperDraft.displayName || ""}
                      onChange={(e) =>
                        setQuestionPaperField({ displayName: e.target.value })
                      }
                    />
                  </label>
                  {renderQuestionPaperMetaFields(questionPaperDraft)}
                  <div className="document-form-actions">
                    <button
                      type="button"
                      className="document-cancel-btn"
                      onClick={() =>
                        setQuestionPaperField({
                          step: "choose",
                          file: null,
                          displayName: "",
                        })
                      }
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="document-save-btn"
                      disabled={!questionPaperDraft.file || importBusy}
                      onClick={() => void saveQuestionPaperUpload()}
                    >
                      {importBusy ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="inline-form">
            <input
              type="text"
              placeholder="Create question bank set"
              value={questionBankInput}
              onChange={(e) => setQuestionBankInput(e.target.value)}
            />
            <button type="button" onClick={addQuestionBankSet}>
              Add Set
            </button>
          </div>

          {questionBankPapers.length === 0 ? (
            <p className="empty-state">No question papers uploaded yet.</p>
          ) : (
            <div className="question-paper-groups">
              {groupQuestionPapersByClassAndSource(questionBankPapers, catalog).map(
                (classGroup) => (
                  <section
                    key={classGroup.classId}
                    className="question-paper-class-group"
                  >
                    <h3 className="question-paper-class-heading">
                      {classGroup.className}
                    </h3>
                    {classGroup.sourceGroups.map((sourceGroup) => (
                      <div
                        key={sourceGroup.source}
                        className="question-paper-source-group"
                      >
                        <h4 className="chapter-category-heading">
                          {sourceGroup.source}
                        </h4>
                        <ul className="chapter-sources question-paper-list">
                          {sourceGroup.papers.map((p) => (
                            <li key={p.id} className="source-item">
                              <div className="source-row-main">
                                <button
                                  type="button"
                                  className="source-name-btn"
                                  onClick={() =>
                                    openQuestionPaperFileWindow(p, {
                                      id: classGroup.classId,
                                      name: classGroup.className,
                                    })
                                  }
                                >
                                  {p.name}
                                </button>
                                <span className="question-paper-meta">
                                  {p.year}
                                  {questionCountByPaperId[p.id]
                                    ? ` · ${questionCountByPaperId[p.id]} questions`
                                    : classifyingBusy
                                      ? " · processing…"
                                      : " · no questions yet"}
                                </span>
                                <button
                                  type="button"
                                  className="question-paper-reextract-btn"
                                  title="Re-extract questions from this paper"
                                  disabled={classifyingBusy}
                                  onClick={() => void reextractQuestionPaper(p)}
                                >
                                  Re-extract
                                </button>
                                <button
                                  type="button"
                                  className="source-action-icon source-action-danger"
                                  title="Delete"
                                  aria-label={`Delete ${p.name}`}
                                  onClick={() => void deleteQuestionPaper(p)}
                                >
                                  🗑
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                )
              )}
            </div>
          )}

          {questionBankSets.length > 0 ? (
            <ul className="question-list">
              {questionBankSets.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </section>

      {compiledModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCompiledModal(null)}
        >
          <div
            className="compiled-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compiled-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="compiled-title">{compiledModal.chapter.name}</h2>
            <p className="compiled-modal-meta">
              {compiledModal.classItem.name} · {compiledModal.unit.name}
              {compiledModal.unit.title ? ` — ${compiledModal.unit.title}` : ""}
            </p>
            <p className="compiled-intro">
              Collated view of every file stored in this chapter’s library. Each section opens the
              same copy you manage with View / Edit / Delete.{" "}
              <strong>Download compiled HTML</strong> embeds your library files for offline use
              (large downloads may take a moment).
            </p>

            {compiledModal.chapter.files.length === 0 ? (
              <p className="empty-state">No files yet. Add materials with +Material.</p>
            ) : (
              <>
                <div className="compiled-body">
                  {compiledModal.chapter.files.map((file, i) => {
                    const href = hrefFor(file);
                    const n = i + 1;
                    return (
                      <section key={file.id} className="compiled-section" id={`compiled-source-${n}`}>
                        <h3>
                          {n}. {file.name}
                        </h3>
                        <p className="source-line-meta">{file.type}</p>
                        {href ? (
                          <p>
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              Open library copy ↗
                            </a>
                          </p>
                        ) : (
                          <p className="source-link-muted">
                            Preview unavailable. The file may need to be added again.
                          </p>
                        )}
                        {file.type === "Image" && href ? (
                          <img src={href} alt="" className="compiled-image" />
                        ) : null}
                        {file.type === "PDF" && href ? (
                          <object
                            data={href}
                            type="application/pdf"
                            className="compiled-pdf"
                            title={file.name}
                          >
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              Open PDF ↗
                            </a>
                          </object>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
                <div className="compiled-source-index">
                  <h4>File index</h4>
                  <ol>
                    {compiledModal.chapter.files.map((file, i) => {
                      const href = hrefFor(file);
                      return (
                        <li key={file.id}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {i + 1}. {file.name}
                            </a>
                          ) : (
                            <span>
                              {i + 1}. {file.name}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </>
            )}

            <div className="compiled-modal-actions">
              <button type="button" onClick={() => setCompiledModal(null)}>
                Close
              </button>
              {compiledModal.chapter.files.length > 0 ? (
                <button type="button" onClick={() => void downloadCompiledHtml()}>
                  Download compiled HTML
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {fileWindowModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeFileWindowModal}
        >
          <div
            className="compiled-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-window-title"
            onClick={(e) => e.stopPropagation()}
          >
            {hrefFor(fileWindowModal.file) ? (
              <button
                type="button"
                className="file-window-fullscreen-btn"
                title="Full screen"
                aria-label="Open file in full screen"
                onClick={() => requestPreviewFullscreen(fileWindowModal.file)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="currentColor"
                    d="M5 5h5V3H3v7h2V5zm9-2v2h5v5h2V3h-7zm5 16h-5v2h7v-7h-2v5zM5 14H3v7h7v-2H5v-5z"
                  />
                </svg>
              </button>
            ) : null}
            <div className="file-window-title-row">
              {fileRenameEditing ? (
                <form
                  className="file-rename-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void renameFileDisplayName();
                  }}
                >
                  <label className="file-rename-label" htmlFor="file-rename-input">
                    Display name
                  </label>
                  <input
                    id="file-rename-input"
                    type="text"
                    className="file-rename-input"
                    value={fileRenameDraft}
                    onChange={(e) => setFileRenameDraft(e.target.value)}
                    autoFocus
                  />
                  <div className="file-rename-actions">
                    <button type="button" onClick={cancelFileRename}>
                      Cancel
                    </button>
                    <button type="submit">Save</button>
                  </div>
                </form>
              ) : (
                <>
                  <h2 id="file-window-title">{fileWindowModal.file.name}</h2>
                  <button
                    type="button"
                    className="file-rename-edit-btn"
                    title="Rename display name"
                    aria-label={`Rename ${fileWindowModal.file.name}`}
                    onClick={startFileRename}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        fill="currentColor"
                        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
            <p className="compiled-modal-meta">{fileWindowModal.file.type}</p>
            {hrefFor(fileWindowModal.file) ? (
              <div className="compiled-body" ref={previewBodyRef}>
                <button
                  type="button"
                  className="file-window-fullscreen-exit-btn"
                  title="Exit full screen"
                  aria-label="Exit full screen"
                  onClick={exitPreviewFullscreen}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M18.3 5.71 12 12.01l6.29 6.29 1.42-1.42L14.83 12l4.88-4.88-1.41-1.41zm-13 1.42L10.17 12 5.29 16.88l1.42 1.42L12 13.42l-6.29-6.29-.41.71z"
                    />
                  </svg>
                </button>
                {fileWindowModal.file.type === "Image" ? (
                  <img src={hrefFor(fileWindowModal.file)} alt="" className="compiled-image" />
                ) : fileWindowModal.file.type === "PDF" ? (
                  <object
                    data={hrefFor(fileWindowModal.file)}
                    type="application/pdf"
                    className="compiled-pdf"
                    title={fileWindowModal.file.name}
                  >
                    <a
                      href={hrefFor(fileWindowModal.file)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open file ↗
                    </a>
                  </object>
                ) : (
                  <p>
                    <a
                      href={hrefFor(fileWindowModal.file)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open file ↗
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <p className="source-link-muted">File preview unavailable.</p>
            )}
            <div className="compiled-modal-actions">
              <button type="button" onClick={closeFileWindowModal}>
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (fileWindowModal.kind === "questionPaper") {
                    replaceTargetRef.current = {
                      kind: "questionPaper",
                      paper: fileWindowModal.paper,
                    };
                    replaceFileInputRef.current?.click();
                    return;
                  }
                  void openEditModal(
                    fileWindowModal.classItem.id,
                    fileWindowModal.unit.id,
                    fileWindowModal.chapter.id,
                    fileWindowModal.file
                  );
                }}
              >
                {fileWindowModal.kind === "questionPaper" ||
                !isTextEditableMaterial(fileWindowModal.file)
                  ? "Replace file"
                  : "Edit content"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {practiseQuestionsModal?.chapter ? (
        <div
          className="modal-backdrop modal-backdrop--fullscreen"
          role="presentation"
          onClick={() => setPractiseQuestionsModal(null)}
        >
          <div
            className="practise-questions-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="practise-questions-title"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const { classItem, unit, chapter } = practiseQuestionsModal;
              const items = sortChapterBankQuestions(
                questionsByChapter(questionBankEntries, chapter.id)
              );
              return (
                <>
                  <h2 id="practise-questions-title">Practise questions</h2>
                  <p className="compiled-modal-meta">
                    {classItem.name} · {unit.name}
                    {unit.title ? ` — ${unit.title}` : ""} · {chapter.name}
                  </p>
                  {items.length === 0 ? (
                    <p className="empty-state">
                      No practise questions for this chapter yet. Upload exam papers in Question
                      Bank — questions are extracted and classified automatically.
                    </p>
                  ) : (
                    <div className="practise-questions-table-wrap">
                      <table className="practise-questions-table">
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Question</th>
                            <th scope="col">Marks</th>
                            <th scope="col">Source</th>
                            <th scope="col">Year</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((entry, index) => {
                            const showSolution = visibleChapterSolutions.has(entry.id);
                            const hasSolution =
                              entry.solution && `${entry.solution}`.trim();
                            return (
                              <tr key={entry.id}>
                                <td className="practise-col-no">{index + 1}</td>
                                <td className="practise-col-question">
                                  <p className="practise-question-text">
                                    {entry.questionText}
                                  </p>
                                  {hasSolution ? (
                                    <div className="practise-question-solution-wrap">
                                      <button
                                        type="button"
                                        className="practise-solution-link"
                                        onClick={() =>
                                          setVisibleChapterSolutions((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(entry.id)) next.delete(entry.id);
                                            else next.add(entry.id);
                                            return next;
                                          })
                                        }
                                        aria-expanded={showSolution}
                                      >
                                        {showSolution ? "Hide solution" : "View solution"}
                                      </button>
                                      {showSolution ? (
                                        <div className="practise-question-solution">
                                          <p>{entry.solution}</p>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="practise-col-marks">
                                  {entry.marks != null ? entry.marks : "—"}
                                </td>
                                <td className="practise-col-source">
                                  {entry.source || "—"}
                                </td>
                                <td className="practise-col-year">
                                  {entry.year ?? "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="compiled-modal-actions">
                    <button type="button" onClick={() => setPractiseQuestionsModal(null)}>
                      Close
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {editModal?.mode === "text" ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setEditModal(null);
            setEditText("");
          }}
        >
          <div
            className="class-modal edit-text-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Edit {editModal.file.name}</h3>
            <textarea
              className="edit-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={16}
              spellCheck="false"
            />
            <div className="class-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setEditModal(null);
                  setEditText("");
                }}
              >
                Cancel
              </button>
              <button type="button" onClick={() => void saveTextEdit()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SignInPage({
  onEmailSignIn,
  onGoogleSignIn,
  onSignUp,
  authError,
  authSuccess,
  authBusy,
  usesSupabaseAuth,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const credentials = () => ({
    email: email.trim(),
    password,
  });

  return (
    <main className="signin-page">
      <header className="signin-brand">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span className="brand-name">Enlightly</span>
        </div>
      </header>
      <section className="signin-hero">
        <p className="eyebrow">VOL. 01 · THE TEACHER'S DESK</p>
        <h1>Welcome back to your studio.</h1>
        <p>A quiet place to plan lessons, share notes, and stay close to every student.</p>
      </section>
      {authError ? (
        <p className="auth-error" role="alert">
          {authError}
        </p>
      ) : null}
      {authSuccess ? (
        <p className="auth-success" role="status">
          {authSuccess}
        </p>
      ) : null}
      {!usesSupabaseAuth ? (
        <p className="auth-hint">
          Supabase is not configured — sign-in is local only and uploads will not sync to the
          database.
        </p>
      ) : null}
      <form
        className="signin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onEmailSignIn(credentials());
        }}
      >
        <label htmlFor="email">EMAIL</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={authBusy}
          required
        />
        <label htmlFor="password">PASSWORD</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={authBusy}
            required
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            disabled={authBusy}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <div className="signin-row">
          <label className="remember">
            <input type="checkbox" defaultChecked disabled={authBusy} />
            <span>Remember me</span>
          </label>
          <a href="#">Forgot password?</a>
        </div>
        <button className="signin-btn" type="submit" disabled={authBusy}>
          {authBusy ? "Signing in…" : "Sign in →"}
        </button>
        {usesSupabaseAuth ? (
          <button
            className="signin-secondary-btn"
            type="button"
            disabled={authBusy}
            onClick={() => void onSignUp(credentials())}
          >
            Create account
          </button>
        ) : null}
        <div className="divider">
          <span>OR</span>
        </div>
        <button
          className="google-btn"
          type="button"
          disabled={authBusy || !usesSupabaseAuth}
          onClick={() => void onGoogleSignIn()}
        >
          Continue with Google
        </button>
      </form>
      <p className="invite-copy">
        New to Enlightly?{" "}
        {usesSupabaseAuth ? (
          <button
            type="button"
            className="link-btn"
            onClick={() => void onSignUp(credentials())}
          >
            Create an account
          </button>
        ) : (
          <span>Configure Supabase to create an account.</span>
        )}
      </p>
      <p className="footer-copy">© Enlightly · Crafted for educators</p>
    </main>
  );
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);

  const isAuthenticated = Boolean(session?.user);

  useEffect(() => {
    const onPathChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPathChange);
    return () => window.removeEventListener("popstate", onPathChange);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!alive) return;
      if (s?.user?.id) migrateUnscopedStorageToUser(s.user.id);
      setSession(s);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (s?.user?.id && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        migrateUnscopedStorageToUser(s.user.id);
      }
      setSession(s);
      setAuthReady(true);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleEmailSignIn = async ({ email: rawEmail, password: rawPassword } = {}) => {
    setAuthError(null);
    setAuthSuccess(null);
    const trimmedEmail = (rawEmail ?? "").trim();
    const pwd = rawPassword ?? "";
    if (!trimmedEmail || !pwd) {
      setAuthError("Enter your email and password.");
      return;
    }
    if (!supabase) {
      setAuthError(
        "Cloud sign-in is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
      );
      return;
    }
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: pwd,
    });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    navigateTo("/dashboard");
  };

  const handleSignUp = async ({ email: rawEmail, password: rawPassword } = {}) => {
    setAuthError(null);
    setAuthSuccess(null);
    const trimmedEmail = (rawEmail ?? "").trim();
    const pwd = rawPassword ?? "";
    if (!trimmedEmail || !pwd) {
      setAuthError("Enter an email and password to create an account.");
      return;
    }
    if (pwd.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    if (!supabase) {
      setAuthError("Supabase is not configured.");
      return;
    }
    setAuthBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password: pwd,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    if (data.user?.identities?.length === 0) {
      setAuthError("An account with this email already exists. Try signing in.");
      return;
    }
    if (data.session) {
      navigateTo("/dashboard");
      return;
    }
    setAuthSuccess(
      "Account created. Check your email for a confirmation link, then sign in. " +
        "In Supabase you can turn off “Confirm email” under Authentication → Providers → Email to sign in immediately."
    );
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    if (!supabase) {
      setAuthError("Google sign-in requires Supabase to be configured.");
      return;
    }
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  };

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    navigateTo("/");
  };

  const signInProps = {
    onEmailSignIn: handleEmailSignIn,
    onGoogleSignIn: handleGoogleSignIn,
    onSignUp: handleSignUp,
    authError,
    authSuccess,
    authBusy,
    usesSupabaseAuth: isSupabaseConfigured,
  };

  if (!authReady) {
    return (
      <main className="signin-page">
        <p className="auth-hint">Loading…</p>
      </main>
    );
  }

  if (!isAuthenticated && path !== "/") {
    navigateTo("/");
    return null;
  }

  if (!isAuthenticated) {
    return <SignInPage {...signInProps} />;
  }

  if (path === "/materials") {
    if (!session?.user?.id) {
      navigateTo("/");
      return null;
    }
    return <MaterialsPage onSignOut={handleSignOut} ownerId={session.user.id} />;
  }
  if (path === "/dashboard" || path === "/") {
    return <DashboardPage onSignOut={handleSignOut} />;
  }
  return <DashboardPage onSignOut={handleSignOut} />;
}
