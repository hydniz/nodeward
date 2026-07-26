import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chips, Tile } from './ui.jsx';

describe('Tile', () => {
  it('shows label, value and hint', () => {
    render(<Tile label="servers" value={12} hint="3 stale" />);
    expect(screen.getByText('servers')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3 stale')).toBeInTheDocument();
  });

  it('clamps the bar to 0–100%', () => {
    const { container } = render(<Tile label="cpu" value="140%" bar={140} />);
    expect(container.querySelector('.tile-fill').style.width).toBe('100%');
  });
});

describe('Chips', () => {
  const options = [
    ['all', 'All'],
    ['up', 'Up', '#3c9'],
    ['down', 'Down', '#e55'],
  ];

  it('marks the active option', () => {
    render(<Chips options={options} value="up" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /up/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'All' })).not.toHaveClass('active');
  });

  it('reports the clicked option id', async () => {
    const onChange = vi.fn();
    render(<Chips options={options} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /down/i }));
    expect(onChange).toHaveBeenCalledWith('down');
  });
});
