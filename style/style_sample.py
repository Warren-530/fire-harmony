import sys, numpy as np, pandas as pd, duckdb, matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.collections import PatchCollection
from matplotlib.colors import LogNorm, TwoSlopeNorm
sys.path.insert(0, '/home/sawy3/nasa_work/style'); import fireharmony_style as fh
fh.use()
OUT=sys.argv[1]
d=pd.read_csv('/mnt/c/users/sawy3/Personal/nasa/Datasets/samples/firms_global_monthly_counts.csv')
veg=d[(d.quality=='sp')&(d.type.astype(str).isin(['0','0.0']))]
yr=veg.groupby(['yr','sensor']).n.sum().unstack().loc[2001:2025]
mon=veg.groupby(['sensor','yr','mo']).n.sum()
# ---- Equal Earth projection ----
A1,A2,A3,A4=1.340264,-0.081106,0.000893,0.003796; M=np.sqrt(3)/2
def ee(lon,lat):
    th=np.arcsin(M*np.sin(np.radians(lat))); t2=th*th; t6=t2**3
    x=np.radians(lon)*np.cos(th)/(M*(A1+3*A2*t2+t6*(7*A3+9*A4*t2))); y=th*(A1+A2*t2+t6*(A3+A4*t2)); return x,y
con=duckdb.connect(); con.load_extension('spatial'); con.sql("LOAD h3")
hexes=con.sql("""SELECT h3_cell_to_boundary_wkt(c) w, n FROM (SELECT h3_latlng_to_cell(ST_Y(geometry),ST_X(geometry),3) c, count(*) n
  FROM '/home/sawy3/nasa_work/data/raw/firms/year=2019/detections.parquet' WHERE type=0 AND quality='sp' AND sensor='VIIRS_NOAA20' GROUP BY 1)""").df()
countries=con.sql("SELECT ST_AsText(ST_Simplify(geom,0.15)) w FROM ST_Read('/vsizip//home/sawy3/nasa_work/data/raw/natural_earth/ne_10m_admin_0_countries.zip/ne_10m_admin_0_countries.shp')").df()
def rings(wkt):
    import re
    for part in re.findall(r'\(\(([^()]+)\)', wkt):
        pts=np.array([[float(v) for v in p.split()] for p in part.split(',')])
        if pts[:,0].max()-pts[:,0].min()>180: continue
        yield pts
fig=plt.figure(figsize=(14,11.2)); gs=fig.add_gridspec(3,2,height_ratios=[0.36,1,1.05],hspace=0.1,wspace=0.08)
# A palette
ax=fig.add_subplot(gs[0,:]); ax.axis('off'); ax.set_xlim(0,24); ax.set_ylim(1.2,3.2)
fh.title(ax,'Fire Harmony visual identity','One palette, one font (Inter), one set of chart rules for the report, app, poster and videos')
groups=[('Sensors (categorical, fixed order)',[(fh.SENSOR[k],fh.SENSOR_LABEL[k]) for k in fh.SENSOR]),('Harmonized record',[(fh.INK,'Emphasis line (ink)')])]
x=0
for name,items in groups:
    ax.text(x,2.85,name,fontsize=9,color=fh.INK_2,fontweight='medium')
    for c,l in items:
        ax.add_patch(plt.Rectangle((x,1.75),0.9,0.8,color=c,lw=0)); ax.text(x,1.45,l,fontsize=7.5,color=fh.INK_2,va='top',rotation=0,wrap=True); x+=2.6
    x+=0.6
ax.text(x,2.85,'Ember: fire amount (sequential)',fontsize=9,color=fh.INK_2,fontweight='medium')
for i,c in enumerate(fh.EMBER): ax.add_patch(plt.Rectangle((x+i*0.42,1.75),0.42,0.8,color=c,lw=0))
ax.text(x,1.45,'less  →  more',fontsize=7.5,color=fh.INK_2,va='top'); x+=4.3
ax.text(x,2.85,'Anomaly: vs normal (diverging)',fontsize=9,color=fh.INK_2,fontweight='medium')
for i,c in enumerate(fh.ANOMALY): ax.add_patch(plt.Rectangle((x+i*0.42,1.75),0.42,0.8,color=c,lw=0))
ax.text(x,1.45,'below   normal   above',fontsize=7.5,color=fh.INK_2,va='top')
# B lines
ax=fig.add_subplot(gs[1,0])
for s in ['MODIS','VIIRS_SNPP','VIIRS_NOAA20']:
    v=yr[s].dropna()/1e6; ax.plot(v.index,v.values,color=fh.SENSOR[s],lw=1.8,label=fh.SENSOR_LABEL[s])
h=(yr['MODIS']*4.45/1e6); ax.plot(h.index,h.values,color=fh.HARMONIZED,lw=2.6,label='Harmonized (illustration only)')
ax.fill_between(h.index,h.values*0.9,h.values*1.1,color=fh.HARMONIZED_BAND,alpha=0.10,lw=0)
fh.clean(ax); ax.set_ylim(0,None); ax.set_xlim(2000.5,2025.5); ax.set_ylabel('Vegetation-fire hotspots / year (millions)')
ax.legend(loc='center left',bbox_to_anchor=(0.30,0.40),fontsize=7.5); fh.title(ax,'Sensor comparison','Thin sensor lines, one ink emphasis line with a 90% band')
# C calendar ember
ax=fig.add_subplot(gs[1,1]); g=(mon.loc['VIIRS_SNPP'].unstack('mo').reindex(index=range(2012,2026),columns=range(1,13)))/1e6
im=ax.imshow(g.values,aspect='auto',cmap='ember',interpolation='nearest')
ax.set_xticks(range(12)); ax.set_xticklabels(list('JFMAMJJASOND')); ax.set_yticks(range(len(g))); ax.set_yticklabels(g.index,fontsize=7.5); ax.grid(False)
for i in range(len(g)+1): ax.axhline(i-0.5,color=fh.SURFACE,lw=1.6)
for j in range(13): ax.axvline(j-0.5,color=fh.SURFACE,lw=1.6)
for s in ax.spines.values(): s.set_visible(False)
cb=fig.colorbar(im,ax=ax,fraction=0.04,pad=0.02); cb.outline.set_visible(False); cb.set_label('millions / month',color=fh.INK_2,fontsize=8)
fh.title(ax,'Burning calendar (ember)','World, VIIRS Suomi NPP, years × months')
# D anomaly calendar
ax=fig.add_subplot(gs[2,0]); gm=mon.loc['MODIS'].unstack('mo').reindex(index=range(2003,2026),columns=range(1,13))
an=np.log2(gm/gm.median()); lim=float(np.nanmax(np.abs(an.values)))
im=ax.imshow(an.values,aspect='auto',cmap='anomaly',norm=TwoSlopeNorm(0,-lim,lim),interpolation='nearest')
ax.set_xticks(range(12)); ax.set_xticklabels(list('JFMAMJJASOND')); ax.set_yticks(range(0,len(an),2)); ax.set_yticklabels(an.index[::2],fontsize=7.5); ax.grid(False)
for i in range(len(an)+1): ax.axhline(i-0.5,color=fh.SURFACE,lw=1.2)
for j in range(13): ax.axvline(j-0.5,color=fh.SURFACE,lw=1.2)
for s in ax.spines.values(): s.set_visible(False)
cb=fig.colorbar(im,ax=ax,fraction=0.04,pad=0.02); cb.outline.set_visible(False); cb.set_ticks([-lim,0,lim]); cb.set_ticklabels([f'{2**-lim:.2f}× normal','normal',f'{2**lim:.2f}× normal']); cb.ax.tick_params(labelsize=7)
fh.title(ax,'Anomaly calendar (diverging)','World, MODIS, each month vs its 2003–2025 median')
# E map
ax=fig.add_subplot(gs[2,1]); ax.set_aspect('equal'); ax.axis('off')
pats,vals=[],[]
for w,n in zip(hexes.w,hexes.n):
    for r in rings(w):
        x,y=ee(r[:,0],r[:,1]); pats.append(Polygon(np.c_[x,y])); vals.append(n)
pc=PatchCollection(pats,cmap='ember',norm=LogNorm(vmin=10,vmax=max(vals)),lw=0); pc.set_array(np.array(vals)); ax.add_collection(pc)
for w in countries.w:
    for r in rings(w):
        x,y=ee(r[:,0],r[:,1]); ax.plot(x,y,color=fh.BASELINE,lw=0.3)
x,y=ee(np.r_[np.full(50,-180),np.linspace(-180,180,50),np.full(50,180),np.linspace(180,-180,50)],np.r_[np.linspace(-90,90,50),np.full(50,90),np.linspace(90,-90,50),np.full(50,-90)])
ax.plot(x,y,color=fh.BASELINE,lw=0.6); ax.set_xlim(x.min()*1.02,x.max()*1.02); ax.set_ylim(y.min()*1.02,y.max()*1.02)
cb=fig.colorbar(pc,ax=ax,fraction=0.035,pad=0.01,orientation='horizontal'); cb.outline.set_visible(False); cb.set_label('hotspots per hexagon, 2019 (log scale)',color=fh.INK_2,fontsize=8)
fh.title(ax,'World map (Equal Earth, H3 hexagons)','VIIRS NOAA-20, 2019, level-3 hexagons (~12,400 km²)')
fh.source(fig,'Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Style sample: the "harmonized" line is an illustration (MODIS × 4.45), not a model result.')
fig.savefig(OUT+'.png',dpi=150); fig.savefig(OUT+'.pdf'); print('saved')
