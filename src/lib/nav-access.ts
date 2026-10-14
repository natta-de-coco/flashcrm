/*
 * What one signed-in person is offered, on every surface that offers things.
 *
 * The sidebar and phone drawer, the phone's bottom bar, search (pages and
 * records) and "+ Create" all answer the same question -- "what may this role
 * open?" -- from the same rule (canOpen, lib/permissions.ts). They used to ask it
 * themselves, each passing the role to its own filter. That is one place per
 * surface where the wrong role could be passed (a hard-coded "company_admin" hands
 * everyone the admin menu) and nothing failed when it was, because the tests only
 * saw that a filter was called, not with whose role.
 *
 * So the role is read once, by the `useNavAccess` hook, and this turns it into
 * the finished lists. A surface takes its list and never names a role, never calls
 * a filter and never imports the unfiltered menu; a test fails if one does.
 */
import {
  mobileBarFor,
  navSectionsFor,
  paletteFor,
  quickCreateFor,
  type NavItem,
  type NavSection,
  type QuickCreateAction,
} from "./navigation";
import { searchRecords, type RecordRows } from "./record-search";

type RecordClient = Parameters<typeof searchRecords>[0];

export type NavAccess = {
  /** The sections the sidebar and the phone drawer show, without empty ones. */
  sections: readonly NavSection[];
  /** The pages search offers. */
  palette: readonly NavItem[];
  /** The tabs of the phone's bottom bar ("More" is always there). */
  mobileBar: readonly NavItem[];
  /** The "+ Create" actions, each with its place in the full list (its translation key). */
  quickCreate: readonly { action: QuickCreateAction; index: number }[];
  /** Search for records, asking only about the kinds this role may open. */
  findRecords: (client: RecordClient, term: string) => Promise<RecordRows>;
};

/**
 * Everything offered to `role`. A role that is unknown or not loaded yet (null)
 * is offered only Home, and its record search sends nothing.
 */
export function navAccessFor(role: string | null | undefined): NavAccess {
  return {
    sections: navSectionsFor(role),
    palette: paletteFor(role),
    mobileBar: mobileBarFor(role),
    quickCreate: quickCreateFor(role),
    findRecords: (client, term) => searchRecords(client, term, role),
  };
}
