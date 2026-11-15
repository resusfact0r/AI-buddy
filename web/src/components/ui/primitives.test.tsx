import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseQueryResult } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { ApiError } from '@/api/errors';
import { InlineAlert } from './InlineAlert';
import { PageHeader } from './PageHeader';
import { QueryView } from './QueryView';
import { Segmented } from './Segmented';
import { RequiredBadge, StatusBadge } from './StatusBadge';

const query = <T,>(over: Partial<UseQueryResult<T>>) =>
  ({
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...over,
  }) as unknown as UseQueryResult<T>;

describe('QueryView', () => {
  it('показывает переданный скелетон во время загрузки', () => {
    render(
      <QueryView query={query({ isPending: true })} loading={<p>грузим</p>}>
        {() => <p>данные</p>}
      </QueryView>,
    );
    expect(screen.getByText('грузим')).toBeInTheDocument();
    expect(screen.queryByText('данные')).not.toBeInTheDocument();
  });

  it('при ошибке показывает текст и повторяет запрос', async () => {
    const q = query({
      isError: true,
      error: new ApiError({ kind: 'network', status: 0, code: 'network', message: 'Нет связи' }),
    });
    render(<QueryView query={q}>{() => null}</QueryView>);
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(q.refetch).toHaveBeenCalled();
  });

  it('отдаёт данные в children', () => {
    render(<QueryView query={query({ data: { n: 3 } })}>{(d) => <p>n={d.n}</p>}</QueryView>);
    expect(screen.getByText('n=3')).toBeInTheDocument();
  });
});

describe('Segmented', () => {
  it('отмечает выбранный вариант и сообщает о смене', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Фильтр"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Первый' },
          { value: 'b', label: 'Второй' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Первый' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Второй' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Второй' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('мелкие примитивы', () => {
  it('StatusBadge и RequiredBadge выводят текст', () => {
    render(
      <>
        <StatusBadge meta={{ label: 'Ждёт', tone: 'warn', icon: Clock3 }} />
        <RequiredBadge required />
        <RequiredBadge required={false} />
      </>,
    );
    expect(screen.getByText('Ждёт')).toBeInTheDocument();
    expect(screen.getByText('обязательная')).toBeInTheDocument();
    expect(screen.getByText('по желанию')).toBeInTheDocument();
  });

  it('InlineAlert — роль alert и действие', () => {
    render(<InlineAlert action={<button type="button">Ещё раз</button>}>Сбой</InlineAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Сбой');
    expect(screen.getByRole('button', { name: 'Ещё раз' })).toBeInTheDocument();
  });

  it('PageHeader — заголовок первого уровня', () => {
    render(
      <PageHeader
        title="Мои заявки"
        description="описание"
        actions={<button type="button">Создать</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Мои заявки' })).toBeInTheDocument();
    expect(screen.getByText('описание')).toBeInTheDocument();
  });
});
