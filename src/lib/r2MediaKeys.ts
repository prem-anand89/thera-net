// Browser-safe HEP picture keys. The rules live in one dependency-free file shared with the hep-media edge function
// (like src/domain/pushPreferences.ts), so the app and the server can never disagree about who may reach which key.
// This file must never import the signer (supabase/functions/_shared/r2Presign.ts): that holds the R2 secret logic.
export {
  buildExerciseMediaKey,
  buildExerciseThumbKey,
  exerciseMediaPrefix,
  isKeyForClinic,
  isStarterKey,
  newKeySuffix,
  parseExerciseMediaKey,
  parseStarterMediaKey,
  validateMediaKeysForClinic,
} from '../../supabase/functions/_shared/hepMediaKeys';
