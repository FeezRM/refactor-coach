import { useEffect, useMemo, useState } from 'react';

type Item = {
  id: string;
  name: string;
  status: string;
  ownerId: string;
  expiresAt?: number;
};

export function Dashboard({ userId, token }: { userId: string; token: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'name' | 'status'>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard?user=${userId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await response.json();
        setItems(json.items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }

    void loadDashboard();
  }, [token, userId]);

  const visibleItems = useMemo(() => {
    return items
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => left[sort].localeCompare(right[sort]));
  }, [items, query, sort, status]);

  function classifyItem(item: Item, now: number, flags: Record<string, boolean>) {
    if (!item) return 'missing';
    if (item.status === 'archived') {
      if (flags.restoreArchived) return 'restorable';
      return 'archived';
    }
    if (item.expiresAt) {
      if (item.expiresAt < now) {
        if (flags.allowExpired) return 'expired_allowed';
        return 'expired';
      }
      if (item.expiresAt === now) return 'expires_today';
    }
    if (item.ownerId === userId) {
      if (flags.needsReview) return 'review';
      return 'owned';
    }
    return 'active';
  }

  return (
    <section style={{ padding: 24 }}>
      <header>
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <button onClick={() => setSort(sort === 'name' ? 'status' : 'name')}>Sort</button>
      </header>
      {loading ? <p>Loading</p> : null}
      {error ? <p>{error}</p> : null}
      {visibleItems.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            setSelectedId(item.id);
            setModalOpen(true);
          }}
        >
          {item.name} {classifyItem(item, Date.now(), { restoreArchived: true })}
        </button>
      ))}
      {modalOpen ? <aside>{selectedId}</aside> : null}
      {refreshing ? <p>Refreshing</p> : null}
      <button onClick={() => setRefreshing(true)}>Refresh</button>
    </section>
  );
}
