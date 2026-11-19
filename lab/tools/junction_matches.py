import csv,re,bisect,math,sys,collections
d=sys.argv[1]; tid=sys.argv[2]
r=list(csv.DictReader(open(f'{d}/{tid}.csv'))); ts=[float(x['time_s']) for x in r]
ev=[]
for line in open(f'{d}/{tid}.serial.txt'):
    m=re.search(r'J t=([\d.]+) n=(\d+) (\w+).*pose=(-?\d+),(-?\d+),[-\d.]+ ahead=(-?\d+)',line)
    if not m: continue
    t=float(m.group(1)); i=min(bisect.bisect(ts,t),len(r)-1)
    h=math.radians(float(r[i]['heading_deg']))
    # the junction is ahead of the axle: use the believed distance between pose and node along the heading
    a=int(m.group(6))/1000; ev.append((t,int(m.group(2)),m.group(3),float(r[i]['x_m'])+a*math.cos(h),float(r[i]['y_m'])+a*math.sin(h)))
by=collections.defaultdict(list)
for t,n,k,x,y in ev: by[n].append((t,x,y))
bad=[(n,max(math.hypot(a[1]-b[1],a[2]-b[2]) for a in v for b in v)) for n,v in by.items() if len(v)>1]
conf=[(n,round(s*100)) for n,s in bad if s>0.15]
first_bad=min((min(t for t,_,_ in by[n][1:]) for n,_ in conf), default=None)
print(f'{len(ev)} junction events, {len(by)} map nodes, revisited {len(bad)}, wrong matches (>15 cm apart): {len(conf)}, first at t={first_bad}')
print('  ', conf[:12])
