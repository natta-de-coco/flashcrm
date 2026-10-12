/**
 * What Flas can do with one connected channel, right now (Batch 2A).
 *
 * Browser-safe and pure: the connection manager, the wizard and the tests all
 * read the same answer. Every state is derived from two facts only --
 *
 *   the registry     does the provider offer it, has Flas built it, which
 *                    scopes does it need, which tier asks for them
 *   the grant        which scopes this authorization requested, and which the
 *                    provider actually granted
 *
 * -- so a capability cannot be shown as available unless both say so.
 */
import {
  CAPABILITY_LABELS,
  type AuthorizationTier,
  type CapabilityKey,
  type ConnectorDefinition,
  CAPABILITY_KEYS,
  tierAvailability,
} from "@/lib/social-connector-definitions";

export type ChannelCapabilityState =
  /** Built, and every scope it needs was granted. */
  | "available"
  /** Built and offered as an upgrade the user has not turned on. */
  | "needs_permission"
  /** Asked for, but the user declined it on the provider's consent screen. */
  | "declined"
  /** The provider offers it; Flas has not built it. */
  | "not_implemented"
  /** The provider has no API for it. */
  | "not_supported";

export type ChannelCapability = {
  key: CapabilityKey;
  label: string;
  state: ChannelCapabilityState;
  /** The tier that enables it, when it is an upgrade the user can turn on. */
  tierId: string | null;
  /** Provider-specific explanation. Never the generic default. */
  note: string | null;
};

const GENERIC_UNSUPPORTED = "This provider does not offer an API for this.";

function tierFor(def: ConnectorDefinition, key: CapabilityKey): AuthorizationTier | null {
  return (def.authorizationTiers ?? []).find((t) => t.capabilities.includes(key)) ?? null;
}

/**
 * Every capability worth showing for this channel.
 *
 * Unsupported capabilities are omitted unless the registry carries a
 * provider-specific note for them -- "YouTube has no private direct-message
 * API" is worth saying; a generic "not offered" row for every key is noise.
 */
export function channelCapabilities(
  def: ConnectorDefinition,
  grantedScopes: readonly string[],
  requestedScopes: readonly string[],
): ChannelCapability[] {
  const granted = new Set(grantedScopes);
  const requested = new Set(requestedScopes);
  const out: ChannelCapability[] = [];

  for (const key of CAPABILITY_KEYS) {
    const facts = def.capabilities[key];
    const tier = tierFor(def, key);
    const note = facts.note && facts.note !== GENERIC_UNSUPPORTED ? facts.note : null;

    if (!facts.providerSupports) {
      if (note) out.push({ key, label: CAPABILITY_LABELS[key], state: "not_supported", tierId: null, note });
      continue;
    }
    if (!facts.flasImplements) {
      // Shown only if it belongs to a tier or has something specific to say;
      // otherwise the card would list every API the provider has.
      if (tier || note) {
        out.push({ key, label: CAPABILITY_LABELS[key], state: "not_implemented", tierId: null, note });
      }
      continue;
    }

    const needed = facts.requiredScopes;
    let state: ChannelCapabilityState;
    if (needed.every((s) => granted.has(s))) state = "available";
    else if (needed.some((s) => requested.has(s) && !granted.has(s))) state = "declined";
    else state = "needs_permission";

    out.push({
      key,
      label: CAPABILITY_LABELS[key],
      state,
      tierId: state === "available" ? null : (tier?.id ?? null),
      note,
    });
  }
  return out;
}

/**
 * "Connected — 5 of 6 enabled capabilities operational", never a bare
 * "Healthy". Enabled = the user asked for it; operational = it was granted.
 */
export function capabilitySummary(caps: readonly ChannelCapability[]): {
  operational: number;
  enabled: number;
  label: string;
} {
  const enabled = caps.filter((c) => c.state === "available" || c.state === "declined").length;
  const operational = caps.filter((c) => c.state === "available").length;
  return {
    operational,
    enabled,
    label:
      enabled === 0
        ? "No capabilities enabled yet"
        : `${operational} of ${enabled} enabled ${enabled === 1 ? "capability" : "capabilities"} operational`,
  };
}

/**
 * Scopes this authorization asked for and did not get. Identity scopes are
 * excluded: declining to share an email makes "Signed in as" unknown, but no
 * channel feature depends on it.
 */
export function declinedScopes(
  def: ConnectorDefinition,
  grantedScopes: readonly string[],
  requestedScopes: readonly string[],
): string[] {
  const identity = new Set(def.identityScopes ?? []);
  const granted = new Set(grantedScopes);
  return requestedScopes.filter((s) => !granted.has(s) && !identity.has(s));
}

/** Upgrades the user can turn on for this channel, with the reason for any that cannot. */
export function upgradeOptions(
  def: ConnectorDefinition,
  grantedScopes: readonly string[],
): Array<{ tier: AuthorizationTier; enabled: boolean; offerable: boolean; reason: string | null }> {
  const granted = new Set(grantedScopes);
  return (def.authorizationTiers ?? [])
    .filter((t) => !t.initial)
    .map((tier) => {
      const { offerable, reason } = tierAvailability(def, tier);
      const scopes = tier.capabilities.flatMap((k) => def.capabilities[k].requiredScopes);
      const enabled = scopes.length > 0 && scopes.every((s) => granted.has(s));
      return { tier, enabled, offerable, reason };
    });
}

/**
 * True when Flas has built nothing for this connector. Connecting it would
 * store a working authorization that no feature uses -- a Connect button that
 * does nothing, which the channel manager must never offer.
 */
export function hasNoImplementedCapability(def: ConnectorDefinition): boolean {
  return !Object.values(def.capabilities).some((f) => f.providerSupports && f.flasImplements);
}

/** The last characters of a provider id, for confirmation screens. */
export function maskIdentifier(id: string): string {
  if (id.length <= 6) return "••••";
  return `••••${id.slice(-4)}`;
}
