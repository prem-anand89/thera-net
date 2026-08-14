/**
 * Core Assessment structured payload — TheraNet Core Assessment Build
 * Handoff v1.3 (external doc, not in this repo). Matches the handoff's
 * `CoreAssessmentPayload` interface field-for-field, with three sections
 * given a reserved shape but a minimal/manual-entry UI rather than the
 * handoff's full interaction, each a standalone project on its own:
 *  - bodyChart: needs the reference artwork + tap-to-mark coordinate UI
 *  - plan.protocolPhases: needs protocol-library.json + the inherits/
 *    overrides resolver (not present in this repo)
 *  - hep.exercises: needs hep-exercise-library.json for the browse/pick UI
 *    (manual free-text entry works today; exerciseId stays optional)
 */

export const PAYLOAD_VERSION = '1.3' as const;

export const RED_FLAG_ITEMS = [
  'Cauda equina',
  'Fracture',
  'Infection',
  'Malignancy',
  'DVT',
  'Vascular',
  'Cord compression',
  'Unexplained weight loss',
] as const;
export type RedFlagItem = (typeof RED_FLAG_ITEMS)[number];
export type RedFlagState = 'yes' | 'no' | 'not-assessed';

export const YELLOW_FLAG_ITEMS = [
  'High distress',
  'Catastrophizing',
  'Job dissatisfaction',
  'Low self-efficacy',
  'Fear avoidance',
] as const;
export type YellowFlagItem = (typeof YELLOW_FLAG_ITEMS)[number];
export type YellowFlagState = 'no-concern' | 'some-concern' | 'significant-concern' | 'not-assessed';

/** Dermatomes and myotomes share the identical level set (handoff §6.3). */
export const NEURO_LEVELS = ['C5', 'C6', 'C7', 'C8', 'T1', 'L2', 'L3', 'L4', 'L5', 'S1', 'S2'] as const;
export type NeuroLevel = (typeof NEURO_LEVELS)[number];
export type DermatomeResult = 'normal' | 'reduced' | 'absent' | 'hypersensitive' | 'not-tested';
export type MyotomeResult = 'normal' | 'reduced' | 'absent' | 'not-tested';

export const REFLEX_ITEMS = ['Biceps', 'Triceps', 'Brachioradialis', 'Patellar', 'Achilles'] as const;
export type ReflexItem = (typeof REFLEX_ITEMS)[number];
export type ReflexResult = 'normal' | 'reduced' | 'absent' | 'hyperreflexic' | 'not-tested';

export const ANATOMICAL_REGIONS = [
  'Cervical Spine',
  'Thoracic Spine',
  'Lumbar Spine',
  'Shoulder',
  'Elbow',
  'Wrist/Hand',
  'Hip',
  'Knee',
  'Ankle/Foot',
] as const;
export type AnatomicalRegion = (typeof ANATOMICAL_REGIONS)[number];

/** The spine-only ROM quick-preset table's fixed row set (§4). */
export const SPINE_ROM = ['Flexion', 'Extension', 'Lateral flexion (L)', 'Lateral flexion (R)', 'Rotation (L)', 'Rotation (R)'];

/** Standard goniometry movement set per region, driving the ROM/MMT movement
 *  dropdown once Anatomical Region is picked — keeps entries consistent
 *  instead of relying on free text for every row. */
export const ROM_MOVEMENTS_BY_REGION: Record<AnatomicalRegion, string[]> = {
  'Cervical Spine': SPINE_ROM,
  'Thoracic Spine': SPINE_ROM,
  'Lumbar Spine': SPINE_ROM,
  Shoulder: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Internal rotation', 'External rotation', 'Horizontal adduction'],
  Elbow: ['Flexion', 'Extension', 'Pronation', 'Supination'],
  'Wrist/Hand': ['Flexion', 'Extension', 'Radial deviation', 'Ulnar deviation', 'Grip strength'],
  Hip: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Internal rotation', 'External rotation'],
  Knee: ['Flexion', 'Extension'],
  'Ankle/Foot': ['Dorsiflexion', 'Plantarflexion', 'Inversion', 'Eversion'],
};

/** The 3 spine regions get the Flexion/Extension/Lateral Flexion/Rotation
 *  quick-preset table (§4) instead of only the freeform ROM list — those
 *  movements are spinal, not applicable to e.g. Shoulder or Knee. */
export const SPINE_REGIONS: readonly AnatomicalRegion[] = ['Cervical Spine', 'Thoracic Spine', 'Lumbar Spine'];

export const OCCUPATION_GROUPS: { group: string; options: string[] }[] = [
  { group: 'Desk / Office', options: ['Desk job', 'IT / computer work', 'Teaching (seated)'] },
  { group: 'Home', options: ['Homemaker'] },
  { group: 'Physical / Manual', options: ['Manual labour', 'Driver', 'Construction', 'Delivery / field work'] },
  { group: 'Other', options: ['Student', 'Retired', 'Other'] },
];

export const ACTIVITY_GROUPS: { group: string; options: string[] }[] = [
  { group: 'Sports', options: ['Cricket', 'Football', 'Badminton', 'Running', 'Swimming', 'Tennis', 'Basketball', 'Other sport'] },
  { group: 'Fitness', options: ['Gym / weight training', 'Yoga', 'Pilates', 'Walking / jogging', 'Cycling'] },
  { group: 'None / Sedentary', options: ['None / sedentary lifestyle'] },
];

export const SESSION_DURATIONS = ['15 min', '30 min', '45 min', '60 min', '90 min'] as const;

export interface PsfsActivity {
  label: string;
  baseline: number;
  baselineDate: string;
  baselineHistory?: { date: string; score: number }[];
  current: number;
}

export interface TraumaEntry {
  date: string;
  dateFormat?: 'month-year' | 'year-only' | 'dont-remember';
  bodyPart: string;
  nature: string;
  treatment: string;
  sequelae: 'none' | 'ongoing';
  sequelaeDetails?: string;
}

export interface SurgeryEntry {
  date: string;
  dateFormat?: 'month-year' | 'year-only' | 'dont-remember';
  procedure: string;
  outcome: 'good' | 'fair' | 'poor';
  complications?: 'none' | string;
  currentStatus: 'recovered' | 'ongoing';
}

export interface PreviousPainEntry {
  id: string;
  region: string;
  timelineOnset?: string;
  timelineDuration?: string;
  intensity?: 'mild' | 'moderate' | 'severe';
  treatment?: string;
}

export interface PalpationEntry {
  region: string;
  findings: string[];
  painOnPalpation: 'none' | 'mild' | 'moderate' | 'severe';
  notes: string;
}

export interface RomEntry {
  movement: string;
  side?: 'L' | 'R';
  active: number | null;
  passive: number | null;
  unit: 'deg' | 'cm';
  painProvoked: boolean;
  endFeel?: 'normal-firm' | 'soft-tissue-approximation' | 'springy-block' | 'hard-bony' | 'empty' | 'not-assessed';
}

export interface StrengthEntry {
  movement: string;
  side?: 'L' | 'R';
  grade: '5/5' | '4/5' | '3/5' | '2/5' | '1/5' | '0/5' | 'not-tested';
  /** Optional nerve-root tag, e.g. "L4" — feeds the neuro-screen myotome row
   *  as a derived value so a graded movement is never re-entered as a screen. */
  nerveRoot?: NeuroLevel;
  notes?: string;
}

export interface SpecialTestEntry {
  testId: string;
  side?: 'L' | 'R' | 'bilateral';
  result: 'negative' | 'positive' | 'inconclusive';
  notes?: string;
}

export interface HepExerciseEntry {
  exerciseId?: string;
  name: string;
  sets: number;
  reps: number;
  unit: 'reps' | 'seconds' | 'minutes';
  frequency: string;
  fromProtocol?: boolean;
}

/** Normalized (0..1) position on the composite front/back/lateral chart image
 *  so marks stay aligned across phone/iPad/laptop and any canvas size — see
 *  BodyChart.tsx. */
export interface BodyChartMark {
  id: string;
  nx: number;
  ny: number;
  type: 'pain' | 'numbness' | 'stiffness' | 'referred';
}

export interface CoreAssessmentPayload {
  version: typeof PAYLOAD_VERSION;
  noteMode: 'initial' | 'followup';
  enrollmentId: string;

  /** Region Modules attach here — additive, versioned independently. */
  regionModules?: Record<string, { version: string; data: unknown }>;

  chiefComplaint: {
    /** Drives the ROM/MMT movement dropdown and the spine-only ROM preset
     *  table (§4) — mandatory, so this is required at the top of the form. */
    anatomicalRegion: AnatomicalRegion | '';
    presentingProblem: string;
    primaryComplaint: string[];
    secondaryComplaints?: {
      id: string;
      region: string;
      onset?: string;
      mechanism?: string;
      episodePattern?: string;
      note?: string;
    }[];
    onset: 'acute-trauma' | 'gradual-overuse' | 'insidious-no-trigger' | 'post-surgical' | '';
    postSurgical?: {
      surgeryType: string;
      surgeryDate: string;
      postOpWeek: number | null;
      protocolLabel?: string;
    };
    occupation: string;
    jobRole?: string;
    activity: string;
    specificDemands?: string;
    mechanism?: string;
    episodePattern: 'first-episode' | 'recurrent-episodes' | 'chronic-ongoing' | 'post-surgical' | '';
    trend: 'improving' | 'stable' | 'worsening' | 'fluctuating' | '';
    priorSurgery: boolean;
    priorSurgeryDetails?: string;
  };

  history: {
    medicalConditions: string[];
    anticoagulant: { onBloodThinner: boolean; details?: string };
    implants: { present: boolean; type?: 'pacemaker' | 'joint-replacement' | 'other'; details?: string };
    pregnancyStatus: 'no' | 'yes' | 'not-applicable';
    medications: string;
    allergies: string;
    traumas: TraumaEntry[];
    surgeries: SurgeryEntry[];
    previousPainHistory?: PreviousPainEntry[];
  };

  screening: {
    redFlags: Record<RedFlagItem, RedFlagState>;
    yellowFlags: Record<YellowFlagItem, YellowFlagState>;
    autoPrompts?: string[];
    bulkCleared: boolean;
  };

  bodyChart: {
    marks: BodyChartMark[];
    dominantSide?: 'L' | 'R' | 'bilateral';
  };

  painProfile: {
    nrs: { current: number | null; best: number | null; worst: number | null };
    pattern: 'constant' | 'intermittent' | 'night-only' | 'morning-stiffness' | '';
    sleepDisturbed: 'no' | 'wakes-occasionally' | 'cannot-return-to-sleep' | '';
    aggravating: string;
    easing: string;
    twentyFourHourPattern: string;
  };

  functionalStatus: {
    activities: PsfsActivity[];
  };

  gaitPosture: {
    gait: string[];
    assistiveDevice: string;
    posture: string[];
    notes: string;
  };

  palpation: PalpationEntry[];

  neurologicalScreen: {
    dermatomes: Partial<Record<NeuroLevel, DermatomeResult>>;
    myotomes: Partial<Record<NeuroLevel, MyotomeResult>>;
    reflexes: Partial<Record<ReflexItem, ReflexResult>>;
    upperMotorNeuronSigns: { present: boolean; details?: string };
  };

  objective: {
    rom: RomEntry[];
    strength: StrengthEntry[];
    specialTests: SpecialTestEntry[];
  };

  treatment: {
    session: {
      manualTherapy: string[];
      therapeuticExercise: string[];
      modalities: string[];
      /** Structured quick-pick (§5); timeSpent stays as the free-text
       *  override/detail for anything non-standard. */
      duration: string;
      timeSpent: string;
      response: 'improved' | 'unchanged' | 'worse' | 'unclear' | '';
      weightBearing?: 'nwb' | 'pwb' | 'wb' | 'fwb';
      pwbPercentage?: number;
      brace?: 'none' | 'hinged' | 'locked';
      lockedDegrees?: string;
      romLimit?: number;
      woundStatus?: 'healed' | 'erythema' | 'swelling' | 'dehiscence' | 'infection-signs';
      sutureStatus?: 'intact' | 'removed' | 'na';
      sutureRemovedDate?: string;
    };
    plannedCourse?: { label: string; startDate: string; expectedEndDate: string };
    notes: string;
  };

  hep: {
    exercises: HepExerciseEntry[];
    compliance: 'doing-all' | 'most-days' | 'some-days' | 'rarely' | 'not-started' | '';
  };

  plan: {
    phase: 'acute' | 'subacute' | 'chronic' | 'maintenance' | 'rts-prep' | 'discharge' | '';
    protocolPhases?: {
      key: string;
      label: string;
      order: number;
      weeks?: string;
      weightBearing?: string;
      brace?: string;
      romLimit?: string;
      goals?: string[];
      exerciseFocus?: string[];
      clearanceCriteria?: string[];
      warnings?: string[];
    }[];
    currentProtocolPhase?: string;
    goals: { text: string; targetDate?: string; targetTerm: 'short-term' | 'long-term' | '' }[];
    estimatedSessions: string;
    patientEducation: string[];
  };

  generalHealth?: {
    weightKg?: number;
    heightCm?: number;
    waistCm?: number;
    bmi?: number;
    bmiFlag?: 'underweight' | 'normal' | 'overweight' | 'obese-i' | 'obese-ii';
    vitals: { date: string; bpSystolic?: number; bpDiastolic?: number; heartRate?: number; o2Saturation?: number; respiratoryRate?: number }[];
    bpFlag?: 'normal' | 'elevated' | 'hypertensive';
    fallsRisk?: {
      falls12Months: number;
      fearOfFalling: 'no' | 'some' | 'significant';
      balanceConcerns: boolean;
      assistiveDevice?: string;
    };
  };

  outcomeTracking?: {
    instruments: {
      instrumentId: string;
      latestScore: number;
      previousScore?: number;
      direction: 'higher-is-better' | 'lower-is-better';
      trend: 'improving' | 'stable' | 'declining';
    }[];
  };

  /** General freeform note, kept independent of the structured payload. */
  freeNotes: string;
}

export function emptyPayload(): CoreAssessmentPayload {
  return {
    version: PAYLOAD_VERSION,
    noteMode: 'initial',
    enrollmentId: '',
    chiefComplaint: {
      anatomicalRegion: '',
      presentingProblem: '',
      primaryComplaint: [],
      onset: '',
      occupation: '',
      activity: '',
      episodePattern: '',
      trend: '',
      priorSurgery: false,
    },
    history: {
      medicalConditions: [],
      anticoagulant: { onBloodThinner: false },
      implants: { present: false },
      pregnancyStatus: 'not-applicable',
      medications: '',
      allergies: '',
      traumas: [],
      surgeries: [],
      previousPainHistory: [],
    },
    screening: {
      redFlags: Object.fromEntries(RED_FLAG_ITEMS.map((r) => [r, 'not-assessed'])) as CoreAssessmentPayload['screening']['redFlags'],
      yellowFlags: Object.fromEntries(YELLOW_FLAG_ITEMS.map((y) => [y, 'not-assessed'])) as CoreAssessmentPayload['screening']['yellowFlags'],
      bulkCleared: false,
    },
    bodyChart: { marks: [] },
    painProfile: {
      nrs: { current: null, best: null, worst: null },
      pattern: '',
      sleepDisturbed: '',
      aggravating: '',
      easing: '',
      twentyFourHourPattern: '',
    },
    functionalStatus: { activities: [] },
    gaitPosture: { gait: [], assistiveDevice: '', posture: [], notes: '' },
    palpation: [],
    neurologicalScreen: { dermatomes: {}, myotomes: {}, reflexes: {}, upperMotorNeuronSigns: { present: false } },
    objective: { rom: [], strength: [], specialTests: [] },
    treatment: {
      session: { manualTherapy: [], therapeuticExercise: [], modalities: [], duration: '', timeSpent: '', response: '' },
      notes: '',
    },
    hep: { exercises: [], compliance: '' },
    plan: { phase: '', goals: [], estimatedSessions: '', patientEducation: [] },
    freeNotes: '',
  };
}

/** Upcasts an older stored payload to the current shape. Completed notes are
 *  immutable, so this runs at read time rather than backfilling stored rows
 *  (handoff's "read-time upcasting, not backfill"). Today there is only one
 *  version, so this is a pass-through merge against emptyPayload() — the
 *  seam exists so a future version bump has somewhere to plug in. */
export function upcastPayload(stored: Record<string, unknown>): CoreAssessmentPayload {
  return { ...emptyPayload(), ...stored } as CoreAssessmentPayload;
}

/** PSFS MCID: >=2-point improvement on the *average* across activities
 *  (handoff §5 — applying the average threshold per-activity over-reports
 *  improvement, so this is deliberately the only place it's evaluated). */
export const PSFS_MCID_THRESHOLD = 2;

export function computeDerivedFields(payload: CoreAssessmentPayload): {
  nrsScore: number | null;
  psfsMean: number | null;
  redFlagCount: number;
  yellowConcernCount: number;
} {
  const activities = payload.functionalStatus.activities;
  const psfsMean =
    activities.length > 0
      ? Math.round((activities.reduce((sum, a) => sum + a.current, 0) / activities.length) * 10) / 10
      : null;
  const redFlagCount = Object.values(payload.screening.redFlags).filter((v) => v === 'yes').length;
  const yellowConcernCount = Object.values(payload.screening.yellowFlags).filter(
    (v) => v === 'some-concern' || v === 'significant-concern'
  ).length;
  return { nrsScore: payload.painProfile.nrs.current, psfsMean, redFlagCount, yellowConcernCount };
}

/** BMI = weight(kg) / height(m)^2, rounded to 1 decimal. Null if either input
 *  is missing — never divide by an absent/zero height. */
export function computeBmi(weightKg: number | undefined, heightCm: number | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

/** Height-to-waist ratio, rounded to 2 decimals. Null if either input is
 *  missing. */
export function computeWaistToHeightRatio(waistCm: number | undefined, heightCm: number | undefined): number | null {
  if (!waistCm || !heightCm) return null;
  return Math.round((waistCm / heightCm) * 100) / 100;
}

export type OutcomeDirection = 'higher-is-better' | 'lower-is-better';
export type OutcomeTrend = 'improving' | 'stable' | 'declining';

/**
 * Trend for one Outcome Tracking instrument (§14.17/§11 of the handoff).
 * Direction is per-instrument, never read off the raw sign of the change —
 * PSFS is higher-is-better, NRS is lower-is-better, so an identical +2
 * change is "improving" for one and "declining" for the other. Getting
 * this backwards renders a deteriorating patient as improving, hence the
 * explicit unit test per registered instrument this handoff calls for.
 */
export function outcomeTrend(direction: OutcomeDirection, previous: number, latest: number): OutcomeTrend {
  if (latest === previous) return 'stable';
  const increased = latest > previous;
  const better = direction === 'higher-is-better' ? increased : !increased;
  return better ? 'improving' : 'declining';
}
