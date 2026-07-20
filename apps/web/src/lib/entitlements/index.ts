export const plans = ["free", "pro", "business"] as const;
export type Plan = (typeof plans)[number];

export const features = [
  "project.create",
  "quote.export",
  "catalog.manage",
  "team.invite",
  "analytics.view",
  "roles.manage",
  "sso.configure",
] as const;
export type Feature = (typeof features)[number];

export type PlanEntitlements = {
  features: ReadonlySet<Feature>;
  limits: {
    projects: number | null;
    teamMembers: number | null;
  };
};

const planEntitlements: Record<Plan, PlanEntitlements> = {
  free: {
    features: new Set(["project.create", "quote.export"]),
    limits: { projects: 3, teamMembers: 1 },
  },
  pro: {
    features: new Set([
      "project.create",
      "quote.export",
      "catalog.manage",
      "team.invite",
      "analytics.view",
    ]),
    limits: { projects: null, teamMembers: 10 },
  },
  business: {
    features: new Set(features),
    limits: { projects: null, teamMembers: null },
  },
};

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && plans.includes(value as Plan);
}

export function getEntitlements(plan: Plan): PlanEntitlements {
  return planEntitlements[plan];
}

export function canAccess(plan: Plan, feature: Feature): boolean {
  return planEntitlements[plan].features.has(feature);
}

export function isWithinLimit(
  plan: Plan,
  limit: keyof PlanEntitlements["limits"],
  currentUsage: number,
): boolean {
  const maximum = planEntitlements[plan].limits[limit];
  return maximum === null || currentUsage < maximum;
}
