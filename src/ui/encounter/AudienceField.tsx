import { SelectField } from '../components/fields';

/** The `AudienceField` value that means every view in its list. */
export const EVERYONE = '';

/** Picks everyone or one of `views` as the receiver of what the DM shows or writes. */
export function AudienceField(props: {
  label: string;
  value: string;
  views: readonly { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  const { label, value, views, onChange } = props;
  return (
    <SelectField
      label={label}
      value={value}
      options={[EVERYONE, ...views.map((v) => v.id)]}
      format={(id) => (id === EVERYONE ? 'Everyone' : (views.find((v) => v.id === id)?.name ?? id))}
      onChange={onChange}
    />
  );
}
