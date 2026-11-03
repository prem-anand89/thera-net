import type { CatalogItem, ReferringSourceItem, TreatmentItem, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';
import { assertNameFree, firstDuplicateName, groupNameCheck, NameTakenError } from '@/domain/nameCheck';

/** How a hidden match is described for each list (shown in {@link NameTakenError}). */
const HIDDEN_SERVICE = 'is in No longer offered';
const HIDDEN_ITEM = 'is hidden';

/** The existing spelling of a group the name matches (capitals and spaces ignored), else the name as typed. */
function canonicalGroup(category: string, items: readonly CatalogItem[]): string {
  const groups = [...new Set(items.map((i) => i.category.trim()).filter(Boolean))];
  const check = groupNameCheck(category, groups);
  return check.kind === 'exact' && check.match ? check.match : category.trim();
}

export function createCatalogService(repos: Repos) {
  /**
   * Every add and rename of a service, treatment or referral source goes through these, so a name that already exists
   * (capitals ignored) is refused before anything is written. The database allows each name once per clinic, and the
   * app saves on the device first, so a duplicate would otherwise look saved and then fail to sync and stay stuck.
   * Screens check the same rule as you type (`nameCheck`) to explain it; this is the safety net.
   */
  async function putService(item: CatalogItem, isNew: boolean): Promise<CatalogItem> {
    const all = await repos.catalog.list(item.clinicId, true);
    assertNameFree(item.name, all, { selfId: isNew ? undefined : item.id, hiddenLabel: HIDDEN_SERVICE });
    const saved = { ...item, name: item.name.trim(), category: canonicalGroup(item.category, all.filter((i) => i.id !== item.id)) };
    await repos.catalog.put(saved);
    return saved;
  }

  return {
    /** Adds a service. Throws {@link NameTakenError} when the name is taken. A group typed with different capitals joins the existing group. */
    addService(item: CatalogItem): Promise<CatalogItem> {
      return putService(item, true);
    },

    /** Saves an edited service (rename, price, group…). Its own unchanged name never counts as taken. */
    updateService(item: CatalogItem): Promise<CatalogItem> {
      return putService(item, false);
    },

    /**
     * First-run setup writes all its services at once: every name is checked against the clinic's list and against the
     * rest of the batch before anything is written, so a duplicate can't leave half the list saved.
     */
    async addServices(items: readonly CatalogItem[]): Promise<void> {
      if (items.length === 0) return;
      const dup = firstDuplicateName(items.map((i) => i.name));
      if (dup) throw new NameTakenError('exact', dup);
      const all = await repos.catalog.list(items[0].clinicId, true);
      for (const item of items) assertNameFree(item.name, all, { hiddenLabel: HIDDEN_SERVICE });
      for (const item of items) await repos.catalog.put({ ...item, name: item.name.trim(), category: item.category.trim() });
    },

    async addTreatment(item: TreatmentItem): Promise<void> {
      const all = await repos.treatmentCatalog.list(item.clinicId, true);
      assertNameFree(item.name, all, { hiddenLabel: HIDDEN_ITEM });
      await repos.treatmentCatalog.put({ ...item, name: item.name.trim() });
    },

    async updateTreatment(item: TreatmentItem): Promise<void> {
      const all = await repos.treatmentCatalog.list(item.clinicId, true);
      assertNameFree(item.name, all, { selfId: item.id, hiddenLabel: HIDDEN_ITEM });
      await repos.treatmentCatalog.put({ ...item, name: item.name.trim() });
    },

    async addReferralSource(item: ReferringSourceItem): Promise<void> {
      const all = await repos.referringSourceCatalog.list(item.clinicId, true);
      assertNameFree(item.name, all, { hiddenLabel: HIDDEN_ITEM });
      await repos.referringSourceCatalog.put({ ...item, name: item.name.trim() });
    },

    async updateReferralSource(item: ReferringSourceItem): Promise<void> {
      const all = await repos.referringSourceCatalog.list(item.clinicId, true);
      assertNameFree(item.name, all, { selfId: item.id, hiddenLabel: HIDDEN_ITEM });
      await repos.referringSourceCatalog.put({ ...item, name: item.name.trim() });
    },

    /**
     * Renames a group: every service in it moves, in one write (one transaction, one sync batch), so a failure can't
     * leave half a group renamed. Typing an existing group's name (capitals ignored) moves them into that group under
     * its spelling. A blank name is refused.
     */
    async renameGroup(clinicId: UUID, from: string, to: string): Promise<string> {
      const target = to.trim();
      if (!target) throw new Error('Group name is required');
      const all = await repos.catalog.list(clinicId, true);
      const groups = [...new Set(all.map((i) => i.category.trim()).filter(Boolean))];
      const check = groupNameCheck(target, groups, from.trim());
      const name = check.kind === 'exact' && check.match ? check.match : target;
      const now = new Date().toISOString();
      const moved = all.filter((i) => i.category.trim() === from.trim()).map((i) => ({ ...i, category: name, updatedAt: now }));
      await repos.catalog.bulkPut(moved);
      return name;
    },

    /** "Remove group (keeps the services)": the group's services become ungrouped, in one write. */
    async removeGroup(clinicId: UUID, group: string): Promise<void> {
      const all = await repos.catalog.list(clinicId, true);
      const now = new Date().toISOString();
      const moved = all.filter((i) => i.category.trim() === group.trim()).map((i) => ({ ...i, category: '', updatedAt: now }));
      await repos.catalog.bulkPut(moved);
    },

    /**
     * How many visits used each service, all time, from local data: a visit counts once per service, from its service
     * lines (or, for an older visit with no lines, its own service). Shown behind "Show usage" and in the edit sheet.
     * Deleting stays gated on `visits.countByService`, which also counts history this skips.
     */
    async usageCounts(clinicId: UUID): Promise<Map<UUID, number>> {
      const [visits, items] = await Promise.all([repos.visits.list({ clinicId }), repos.visitItems.listByClinic(clinicId)]);
      const perVisit = new Map<UUID, Set<UUID>>();
      for (const it of items) {
        if (it.deleted || !it.serviceCatalogId) continue;
        if (!perVisit.has(it.visitId)) perVisit.set(it.visitId, new Set());
        perVisit.get(it.visitId)!.add(it.serviceCatalogId);
      }
      const counts = new Map<UUID, number>();
      const bump = (id: UUID) => counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const v of visits) {
        const lines = perVisit.get(v.id);
        if (lines) lines.forEach(bump);
        else if (v.serviceCatalogId) bump(v.serviceCatalogId);
      }
      return counts;
    },

    /**
     * Permanent delete, zero-history services only — enforced server-side
     * by the hard_delete_catalog_item RPC (blocks if any visit references
     * this item). Online-only because deletes don't travel through the
     * offline outbox. A service with any history must go through the
     * existing Deactivate action instead.
     */
    async hardDelete(id: UUID): Promise<void> {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase is not configured');
      if (!navigator.onLine) {
        throw new Error('Deleting permanently needs a connection — try again when online.');
      }
      const { error } = await supabase.rpc('hard_delete_catalog_item', { p_item_id: id });
      if (error) throw new Error(error.message);
      await repos.catalog.removeLocal(id);
    },
  };
}
