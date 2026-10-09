import type { UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { getSupabase } from '@/lib/supabase';

export function createCatalogService(repos: Repos) {
  return {
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
