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
