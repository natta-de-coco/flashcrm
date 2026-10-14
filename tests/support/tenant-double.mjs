// Stands in for hooks/useTenant when the real useNavAccess hook is bundled for a
// test: the test sets who is signed in, the hook reads it like it reads the real
// one. Unset means "the profile has not loaded yet".
export function useTenant() {
  return globalThis.__tenantDouble ?? { staffRole: null, loading: true };
}
