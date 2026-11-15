import { render, screen } from '@testing-library/react';
import { Buddy } from './Buddy';

describe('Buddy', () => {
  it('по умолчанию декоративный и в состоянии простоя', () => {
    const { container } = render(<Buddy />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-mood', 'idle');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('data-still');
    expect(container.querySelector('.buddy-eyes')).not.toBeNull();
  });

  it('с подписью озвучивается как изображение', () => {
    render(<Buddy label="Бадди" />);
    expect(screen.getByRole('img', { name: 'Бадди' })).toBeInTheDocument();
  });

  it('«думает»: над стикером три квадрата', () => {
    const { container } = render(<Buddy mood="thinking" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-mood', 'thinking');
    expect(container.querySelectorAll('.buddy-dot')).toHaveLength(3);
    expect(container.querySelector('.buddy-check')).toBeNull();
  });

  it('«ответ найден»: галочка и два вылетающих квадрата, глаза закрыты', () => {
    const { container } = render(<Buddy mood="found" />);
    expect(container.querySelector('.buddy-check')).not.toBeNull();
    expect(container.querySelectorAll('.buddy-spark')).toHaveLength(2);
    expect(container.querySelector('.buddy-eyes')).toBeNull();
  });

  it('компактный вариант — только стикер, без «руки» и украшений', () => {
    const { container } = render(<Buddy mood="found" compact still size={30} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '64 64 272 272');
    expect(svg).toHaveAttribute('width', '30');
    expect(svg).toHaveAttribute('data-still');
    expect(container.querySelector('.buddy-hand')).toBeNull();
    expect(container.querySelector('.buddy-spark')).toBeNull();
  });
});
