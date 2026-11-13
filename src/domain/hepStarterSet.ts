// An OPTIONAL starter list a clinic can copy into its own Library (Library > Add from starter set). Nothing here is
// ever seeded automatically: the clinic starts empty and chooses. Each one is text only (no pictures); the clinic adds
// photos or a GIF of its own. Pelvic floor exercises are deliberately left out.
//
// REVIEW BEFORE SHIPPING (amendment 74): this wording is a draft written for a physiotherapist to read, correct and
// approve. Do not release the starter set to clinics until the owner or a physio has gone through every line.
import type { DoseType, ExercisePhase, ExerciseSide } from '@/domain/hep';

export interface StarterExercise {
  title: string;
  otherNames?: string[];
  region: string;
  alsoRegions?: string[];
  phase: ExercisePhase;
  equipment?: string[];
  /** One step per line, as the patient reads them. */
  steps: string[];
  stopIf: string;
  dose: { kind: DoseType; sets: number; reps?: number; holdSeconds?: number; durationSeconds?: number; restSeconds: number; side: ExerciseSide; perDay: 1 | 2 | 3 };
}

const REPS = (sets: number, reps: number, side: ExerciseSide = 'none', perDay: 1 | 2 | 3 = 1) => ({ kind: 'reps' as const, sets, reps, restSeconds: 30, side, perDay });
const HOLD = (sets: number, reps: number, holdSeconds: number, side: ExerciseSide = 'none', perDay: 1 | 2 | 3 = 1) => ({ kind: 'hold' as const, sets, reps, holdSeconds, restSeconds: 30, side, perDay });
const TIMED = (sets: number, durationSeconds: number, side: ExerciseSide = 'none', perDay: 1 | 2 | 3 = 1) => ({ kind: 'timed' as const, sets, durationSeconds, restSeconds: 30, side, perDay });

const PAIN = 'Sharp or increasing pain';

export const STARTER_EXERCISES: StarterExercise[] = [
  // Neck
  { title: 'Chin Tucks', region: 'Neck', phase: 'activation', steps: ['Sit or stand tall, looking straight ahead', 'Gently draw your chin straight back, as if making a double chin', 'Hold, then relax'], stopIf: `${PAIN}, dizziness or arm tingling`, dose: HOLD(2, 10, 5, 'none', 2) },
  { title: 'Upper Trapezius Stretch', region: 'Neck', alsoRegions: ['Shoulder'], phase: 'stretching', steps: ['Sit tall and let one shoulder relax down', 'Tilt your head away until you feel a gentle stretch along the side of the neck', 'Hold, then change sides'], stopIf: `${PAIN}, dizziness or arm tingling`, dose: HOLD(1, 3, 30, 'both', 2) },
  // Shoulder
  { title: 'Pendulum Swings', region: 'Shoulder', phase: 'warm_up', steps: ['Lean forward with one hand on a table', 'Let the other arm hang loose', 'Swing it gently in small circles, then change direction'], stopIf: PAIN, equipment: ['Chair'], dose: TIMED(2, 30, 'both', 2) },
  { title: 'Wall Slides', otherNames: ['Wall angels'], region: 'Shoulder', phase: 'mobility', equipment: ['Wall'], steps: ['Stand facing a wall with your forearms on it', 'Slide your arms up as far as is comfortable', 'Slide back down slowly'], stopIf: PAIN, dose: REPS(3, 10, 'none', 2) },
  { title: 'Scapular Squeeze', otherNames: ['Shoulder blade squeeze'], region: 'Shoulder', alsoRegions: ['Spine / Back'], phase: 'activation', steps: ['Sit or stand tall with your arms relaxed', 'Squeeze your shoulder blades together and slightly down', 'Hold, then relax'], stopIf: PAIN, dose: HOLD(2, 10, 5, 'none', 2) },
  { title: 'Band External Rotation', region: 'Shoulder', phase: 'strengthening', equipment: ['Theraband / resistance band'], steps: ['Hold a band with your elbow at your side, bent to a right angle', 'Rotate your forearm outwards, keeping the elbow tucked in', 'Return slowly'], stopIf: PAIN, dose: REPS(3, 12, 'both', 1) },
  { title: 'Cross-body Stretch', region: 'Shoulder', phase: 'stretching', steps: ['Bring one arm across your chest', 'Support it with the other hand just above the elbow', 'Hold the gentle stretch, then change sides'], stopIf: PAIN, dose: HOLD(1, 3, 30, 'both', 1) },
  // Elbow / Wrist / Hand
  { title: 'Wrist Flexor Stretch', region: 'Elbow / Wrist / Hand', phase: 'stretching', steps: ['Hold your arm out with the palm facing up', 'Use the other hand to gently pull the fingers down and back', 'Hold, then change sides'], stopIf: `${PAIN} or tingling in the fingers`, dose: HOLD(1, 3, 30, 'both', 2) },
  // Spine / Back
  { title: 'Cat–Camel', region: 'Spine / Back', alsoRegions: ['Core'], phase: 'mobility', equipment: ['Mat'], steps: ['Start on hands and knees', 'Arch your back up towards the ceiling', 'Then let it sag gently towards the floor, moving slowly'], stopIf: PAIN, dose: REPS(2, 10, 'none', 1) },
  { title: 'Pelvic Tilt', region: 'Spine / Back', alsoRegions: ['Core'], phase: 'mobility', equipment: ['Mat'], steps: ['Lie on your back with your knees bent', 'Flatten your lower back gently into the floor by tightening your tummy', 'Relax and repeat'], stopIf: PAIN, dose: REPS(2, 10, 'none', 2) },
  { title: 'Knee-to-chest Stretch', region: 'Spine / Back', alsoRegions: ['Hip'], phase: 'stretching', equipment: ['Mat'], steps: ['Lie on your back', 'Bring one knee towards your chest, holding behind the thigh', 'Hold, then change sides'], stopIf: `${PAIN} or pain down the leg`, dose: HOLD(1, 3, 20, 'both', 2) },
  { title: 'Bird Dog', region: 'Spine / Back', alsoRegions: ['Core'], phase: 'strengthening', equipment: ['Mat'], steps: ['Start on hands and knees with a flat back', 'Reach one arm forward and the opposite leg back', 'Hold without letting your back sag, then change sides'], stopIf: PAIN, dose: HOLD(2, 8, 5, 'both', 1) },
  // Core
  { title: 'Dead Bug', region: 'Core', phase: 'strengthening', equipment: ['Mat'], steps: ['Lie on your back with your knees and arms raised', 'Slowly lower one arm and the opposite leg towards the floor', 'Return, keeping your lower back flat, then change sides'], stopIf: PAIN, dose: REPS(2, 10, 'both', 1) },
  { title: 'Plank', region: 'Core', alsoRegions: ['Whole body'], phase: 'strengthening', equipment: ['Mat'], steps: ['Rest on your forearms and knees or toes', 'Keep your body in one straight line', 'Hold, breathing normally'], stopIf: `${PAIN} in the back or shoulders`, dose: TIMED(2, 30, 'none', 1) },
  // Hip
  { title: 'Glute Bridge', region: 'Hip', alsoRegions: ['Core'], phase: 'strengthening', equipment: ['Mat'], steps: ['Lie on your back with your knees bent and feet flat', 'Squeeze your buttocks and lift your hips', 'Hold, then lower slowly'], stopIf: `${PAIN} or cramping`, dose: HOLD(3, 12, 5, 'none', 1) },
  { title: 'Clamshells', region: 'Hip', phase: 'strengthening', equipment: ['Mat', 'Theraband / resistance band'], steps: ['Lie on your side with your knees bent and feet together', 'Keeping your feet together, lift the top knee', 'Lower slowly'], stopIf: PAIN, dose: REPS(3, 12, 'both', 1) },
  { title: 'Straight Leg Raise', otherNames: ['SLR'], region: 'Hip', alsoRegions: ['Knee'], phase: 'strengthening', equipment: ['Mat'], steps: ['Lie on your back with one knee bent and the other leg straight', 'Tighten the thigh of the straight leg and lift it to the height of the other knee', 'Lower slowly'], stopIf: PAIN, dose: REPS(3, 10, 'both', 1) },
  { title: 'Hip Flexor Stretch', region: 'Hip', phase: 'stretching', equipment: ['Mat'], steps: ['Kneel on one knee with the other foot in front', 'Gently push your hips forward until you feel a stretch at the front of the back hip', 'Hold, then change sides'], stopIf: `${PAIN} or knee pain`, dose: HOLD(1, 3, 30, 'both', 1) },
  // Knee
  { title: 'Quad Sets', otherNames: ['Isometric quads'], region: 'Knee', phase: 'activation', equipment: ['Towel'], steps: ['Sit or lie with your leg straight and a rolled towel under the knee', 'Press the back of the knee down into the towel by tightening the thigh', 'Hold, then relax'], stopIf: PAIN, dose: HOLD(3, 12, 10, 'none', 3) },
  { title: 'Heel Slides', region: 'Knee', phase: 'mobility', equipment: ['Mat'], steps: ['Lie on your back with your legs straight', 'Slide one heel towards your buttocks, bending the knee', 'Slide back to straight'], stopIf: PAIN, dose: REPS(2, 10, 'both', 3) },
  { title: 'Hamstring Stretch', region: 'Knee', alsoRegions: ['Hip'], phase: 'stretching', equipment: ['Towel'], steps: ['Lie on your back and loop a towel around one foot', 'Raise that leg, keeping the knee only slightly bent', 'Hold the gentle stretch at the back of the thigh, then change sides'], stopIf: `${PAIN} or tingling down the leg`, dose: HOLD(1, 3, 30, 'both', 2) },
  { title: 'Mini Squats', region: 'Knee', alsoRegions: ['Hip'], phase: 'strengthening', equipment: ['Wall'], steps: ['Stand with your back against a wall, feet shoulder-width apart', 'Bend your knees a little way, as if starting to sit', 'Straighten up slowly'], stopIf: PAIN, dose: REPS(3, 10, 'none', 1) },
  { title: 'Sit to Stand', region: 'Knee', alsoRegions: ['Hip', 'Whole body'], phase: 'functional', equipment: ['Chair'], steps: ['Sit at the front of a sturdy chair', 'Stand up without using your hands if you can', 'Sit back down slowly'], stopIf: `${PAIN} or dizziness`, dose: REPS(3, 8, 'none', 1) },
  // Ankle / Foot
  { title: 'Ankle Pumps', region: 'Ankle / Foot', phase: 'warm_up', steps: ['Sit or lie with your legs supported', 'Point your feet away, then pull them back towards you', 'Repeat smoothly'], stopIf: `${PAIN} or calf pain that is new`, dose: REPS(2, 20, 'none', 3) },
  { title: 'Calf Stretch', region: 'Ankle / Foot', phase: 'stretching', equipment: ['Wall'], steps: ['Stand facing a wall with one foot back, heel down', 'Lean forward, keeping the back knee straight', 'Hold, then change sides'], stopIf: PAIN, dose: HOLD(1, 3, 30, 'both', 2) },
  { title: 'Heel Raises', region: 'Ankle / Foot', phase: 'strengthening', equipment: ['Chair'], steps: ['Stand holding a chair or counter for balance', 'Rise up onto your toes', 'Lower slowly'], stopIf: `${PAIN} or dizziness`, dose: REPS(3, 12, 'none', 1) },
  { title: 'Single-leg Stand', region: 'Ankle / Foot', alsoRegions: ['Knee'], phase: 'balance', equipment: ['Chair'], steps: ['Stand next to a chair or counter, ready to hold on', 'Lift one foot off the floor and balance', 'Change sides'], stopIf: 'Dizziness, or if you feel you may fall', dose: TIMED(3, 30, 'both', 1) },
  // Whole body
  { title: 'Marching on the Spot', region: 'Whole body', phase: 'warm_up', steps: ['Stand tall near a wall or chair', 'March on the spot, lifting your knees comfortably', 'Swing your arms gently'], stopIf: 'Chest pain, breathlessness or dizziness', dose: TIMED(1, 60, 'none', 1) },
];
