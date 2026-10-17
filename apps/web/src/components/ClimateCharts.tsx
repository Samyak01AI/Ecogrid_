import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';

type ZonePoint = { name: string; heat: number; green: number };
type ImpactPoint = { name: string; before: number; after: number };
type SparkPoint = { value: number };
type Props =
  | { mode: 'zones'; data: ZonePoint[] }
  | { mode: 'impact'; data: ImpactPoint[] }
  | { mode: 'spark'; data: SparkPoint[] };

function Tooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><b>{label}</b>{payload.map((item) => <span key={item.name}><i style={{ backgroundColor: item.color ?? '#4CC38A' }} />{item.name} <strong>{item.value.toFixed(1)}</strong></span>)}</div>;
}

export default function ClimateCharts(props: Props) {
  if (props.mode === 'spark') return <ResponsiveContainer width="100%" height={48}><AreaChart data={props.data}><Area type="monotone" dataKey="value" stroke="#4CC38A" strokeWidth={2} fill="rgba(76,195,138,.12)" /></AreaChart></ResponsiveContainer>;
  if (props.mode === 'zones') return <ResponsiveContainer width="100%" height="100%"><BarChart data={props.data} margin={{ top: 12, right: 0, bottom: 0, left: -26 }}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="var(--border-soft)" /><XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 8 }} interval={0} angle={-17} textAnchor="end" height={42} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--muted)', fontSize: 9 }} axisLine={false} tickLine={false} /><ChartTooltip content={<Tooltip />} /><Bar dataKey="heat" name="Heat risk" fill="#F3B44E" radius={[3, 3, 0, 0]} barSize={10} /><Bar dataKey="green" name="Vegetation deficit" fill="#4CC38A" radius={[3, 3, 0, 0]} barSize={10} /></BarChart></ResponsiveContainer>;
  return <ResponsiveContainer width="100%" height="100%"><BarChart data={props.data} margin={{ top: 12, right: 0, bottom: 0, left: -20 }}><CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--border-soft)" /><XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 9 }} axisLine={false} tickLine={false} /><ChartTooltip content={<Tooltip />} /><Bar dataKey="before" name="Before" fill="#56766B" radius={[4, 4, 0, 0]} barSize={14} /><Bar dataKey="after" name="After" fill="#4CC38A" radius={[4, 4, 0, 0]} barSize={14} /></BarChart></ResponsiveContainer>;
}
