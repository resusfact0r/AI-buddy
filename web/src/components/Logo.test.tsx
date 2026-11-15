import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('в шапке — неподвижный Бадди и название', () => {
    const { container } = render(<Logo />);
    expect(screen.getByText('AI-buddy')).toBeInTheDocument();
    const buddy = container.querySelector('svg.buddy')!;
    expect(buddy).toHaveAttribute('width', '36');
    expect(buddy).toHaveAttribute('data-still');
    expect(buddy).toHaveAttribute('aria-hidden', 'true');
  });

  it('на экране входа — крупный и «живой»', () => {
    const { container } = render(<Logo size="lg" />);
    const buddy = container.querySelector('svg.buddy')!;
    expect(buddy).toHaveAttribute('width', '48');
    expect(buddy).not.toHaveAttribute('data-still');
  });
});
