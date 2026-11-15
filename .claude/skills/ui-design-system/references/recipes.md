# Рецепты разметки

Копируй и адаптируй. Всё на токенах из `tailwind.config.ts`.

## Заголовок страницы

```tsx
<header className="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 className="text-title font-bold">Мои заявки</h1>
    <p className="mt-1 text-ink-soft">Статусы обновляются автоматически</p>
  </div>
  <Button>
    <Plus className="h-4 w-4" aria-hidden />
    Новая заявка
  </Button>
</header>
```

## Карточка секции со списком

```tsx
<section className="card" aria-labelledby="tasks-title">
  <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
    <h2 id="tasks-title" className="text-lg font-bold">Задачи на неделю</h2>
    <Button size="sm" variant="ghost">Все</Button>
  </div>
  <ul className="divide-y divide-line">
    {items.map((t) => (
      <li key={t.id} className="flex items-center gap-3 px-6 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
          <ListChecks className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.title}</div>
          <div className="truncate text-xs text-ink-muted">{t.meta}</div>
        </div>
        <RequestStatusBadge status={t.status} />
      </li>
    ))}
  </ul>
</section>
```

## Плитка-метрика

```tsx
<div className="card p-4">
  <div className="text-xs font-medium text-ink-muted">Выполнено</div>
  <div className="mt-1 text-title font-bold tabular-nums">12 из 20</div>
  <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
    <div className="h-full w-full origin-left bg-ok" style={{ transform: 'scaleX(0.6)' }} />
  </div>
</div>
```

## Hero-карточка

```tsx
<section className="card overflow-hidden">
  <div className="bg-brand-soft px-6 pb-5 pt-6">
    <h1 className="text-title font-bold">Привет, Анна</h1>
    <p className="mt-1 text-ink-soft">3-й день в компании</p>
  </div>
  <div className="p-4">…</div>
</section>
```

## Чипы-фильтры

```tsx
<div role="group" aria-label="Фильтр" className="flex flex-wrap gap-2">
  {filters.map((f) => (
    <button
      key={f.id}
      type="button"
      aria-pressed={f.id === active}
      onClick={() => setActive(f.id)}
      className={cn(
        'h-9 rounded-full px-4 text-sm font-semibold transition-colors',
        f.id === active ? 'bg-ink text-white' : 'bg-white text-ink-soft shadow-card hover:text-ink',
      )}
    >
      {f.label}
    </button>
  ))}
</div>
```

## Инфо-плашка (алерт)

```tsx
<div className="flex items-start gap-3 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-strong">
  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
  <p className="flex-1">Доступ выдаётся в течение рабочего дня после одобрения.</p>
</div>
```
Тон меняется заменой `brand` на `warn` / `ok` / `danger` / `violet`.

## Форма в модалке

```tsx
<Modal open={open} onOpenChange={setOpen} title="Запросить доступ" description="Руководитель получит уведомление">
  <form onSubmit={onSubmit} className="space-y-4" noValidate>
    <Field label="Система" error={errors.system}>
      <select className="input">…</select>
    </Field>
    <Field label="Зачем нужен доступ" hint="Пара предложений" error={errors.reason}>
      <textarea className="input min-h-24 resize-y" />
    </Field>
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={() => setOpen(false)}>Отмена</Button>
      <Button type="submit" loading={m.isPending}>Отправить заявку</Button>
    </div>
  </form>
</Modal>
```

## Скелетон списка

```tsx
<div role="status" aria-label="Загрузка заявок" className="card space-y-3 p-6">
  {Array.from({ length: 3 }, (_, i) => (
    <div key={i} className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-2xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  ))}
</div>
```
