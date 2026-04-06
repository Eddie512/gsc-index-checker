import type { FC } from 'hono/jsx';

export interface DropdownOption {
  value: string;
  label: string;
}

const ChevronDown: FC = () => (
  <svg width="10" height="6" viewBox="0 0 10 6">
    <path d="M0 0l5 6 5-6z" fill="currentColor" />
  </svg>
);

export const Dropdown: FC<{
  name: string;
  options: DropdownOption[];
  selected: string;
}> = ({ name, options, selected }) => {
  const selectedOpt = options.find((o) => o.value === selected) || options[0];
  return (
    <div class="dd" data-name={name}>
      <input type="hidden" name={name} value={selected} />
      <div class="dd-trigger">
        {selectedOpt?.label || ''}
        <ChevronDown />
      </div>
      <div class="dd-panel">
        {options.map((o) => (
          <div
            class={`dd-item${o.value === selected ? ' dd-active' : ''}`}
            data-value={o.value}
          >
            {o.label}
          </div>
        ))}
      </div>
    </div>
  );
};
