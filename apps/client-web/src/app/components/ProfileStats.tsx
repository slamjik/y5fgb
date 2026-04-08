interface ProfileStatsProps {
  postsCount: number;
  storiesCount: number;
  friendsCount?: number;
}

export function ProfileStats({ postsCount, storiesCount, friendsCount = 0 }: ProfileStatsProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <article
        className="rounded-2xl border p-5"
        style={{
          backgroundColor: "var(--glass-fill-base)",
          borderColor: "var(--glass-border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--base-grey-light)" }}>
          Публикации
        </p>
        <p style={{ color: "var(--text-primary)", fontSize: 34, fontWeight: 700 }}>{postsCount}</p>
      </article>

      <article
        className="rounded-2xl border p-5"
        style={{
          backgroundColor: "var(--glass-fill-base)",
          borderColor: "var(--glass-border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--base-grey-light)" }}>
          Истории
        </p>
        <p style={{ color: "var(--text-primary)", fontSize: 34, fontWeight: 700 }}>{storiesCount}</p>
      </article>

      <article
        className="rounded-2xl border p-5"
        style={{
          backgroundColor: "var(--glass-fill-base)",
          borderColor: "var(--glass-border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--base-grey-light)" }}>
          Друзья
        </p>
        <p style={{ color: "var(--text-primary)", fontSize: 34, fontWeight: 700 }}>{friendsCount}</p>
      </article>
    </section>
  );
}

