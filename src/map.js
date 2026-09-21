import { point, route, floodRow, assessment, isOpen, availableCapacity, evacuationPlan, launchSites, submerged } from './engine.js';

const TAU = Math.PI * 2;
const clamp01 = n => Math.max(0, Math.min(1, n));
const hash = value => {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
};
const seeded = (key, salt = 0) => hash(`${key}:${salt}`);
const shade = (hex, amount=-18) => {
    const raw=hex.replace('#','').slice(0,6); if(raw.length!==6)return hex;
    const n=parseInt(raw,16), clamp=v=>Math.max(0,Math.min(255,v));
    return `#${[n>>16,(n>>8)&255,n&255].map(v=>clamp(v+amount).toString(16).padStart(2,'0')).join('')}`;
};

// Seattle-inspired, intentionally irregular. The simulation topology is unchanged;
// visual street positions are staggered so the city no longer reads as a square grid.
const TOWN_LAYOUT = {
    A1:[.105,.105], B1:[.325,.075], C1:[.555,.105], D1:[.795,.082],
    A2:[.090,.300], B2:[.305,.270], C2:[.555,.305], D2:[.820,.285],
    A3:[.125,.515], B3:[.350,.485], C3:[.595,.530], D3:[.845,.500],
    A4:[.105,.725], B4:[.330,.705], C4:[.585,.745], D4:[.825,.715],
    S1:[.180,.935], S2:[.500,.945], S3:[.820,.935],
    S4:[.025,.555]
};

const MAJOR_ROADS = new Set([
    'A1:B1','B1:C1','C1:D1',
    'A2:B2','B2:C2','C2:D2',
    'A3:B3','B3:C3','C3:D3',
    'A4:B4','B4:C4','C4:D4',
    'B1:B2','B2:B3','B3:B4',
    'D1:D2','D2:D3','D3:D4'
]);
const SECONDARY_ROADS = new Set([
    'A1:A2','A2:A3','A3:A4',
    'C1:C2','C2:C3','C3:C4',
    'A4:S1','B4:S2','C4:S2','D4:S3','A3:S4'
]);

const BUILDING_PALETTES = [
    ['#f1f1ef','#e7e8e7','#dadcdb','#eee9df'],
    ['#eeeeec','#e2e4e3','#d4d8d8','#efe7d7'],
    ['#f4f3ef','#e8e6e1','#d9d8d4','#eadfca'],
    ['#efefed','#e2e5e4','#d4d8d6','#eee5d4'],
    ['#f3f1ec','#e5e3de','#d8d5cf','#efe4cf'],
    ['#efefee','#e1e4e5','#d3d7d8','#ebe3d5'],
    ['#f4f4f1','#e7e7e4','#d9dcda','#efe5d2'],
    ['#efefec','#e1e2df','#d4d6d2','#ede2cf']
];

const PARKS = [
    {name:'Seattle Center', points:[[.405,.035],[.560,.025],[.615,.095],[.590,.168],[.470,.185],[.395,.120]]},
    {name:'Olympic Sculpture Park', points:[[.035,.205],[.135,.175],[.205,.230],[.175,.330],[.070,.350],[.028,.285]]},
    {name:'Westlake Park', points:[[.445,.335],[.525,.322],[.560,.370],[.520,.410],[.438,.390]]},
    {name:'Freeway Park', points:[[.680,.420],[.800,.408],[.825,.485],[.760,.530],[.672,.500]]},
    {name:'Waterfront Garden', points:[[.020,.555],[.115,.535],[.150,.610],[.108,.690],[.035,.678]]}
];

const LANDMARKS = [
    {name:'Space Needle',x:.505,y:.078,kind:'needle'},
    {name:'Pike Place Market',x:.235,y:.352,kind:'market'},
    {name:'Seattle Great Wheel',x:.060,y:.430,kind:'wheel'},
    {name:'Seattle Aquarium',x:.115,y:.465,kind:'waterfront'},
    {name:'Seattle Art Museum',x:.330,y:.485,kind:'museum'},
    {name:'Columbia Center',x:.575,y:.548,kind:'tower'},
    {name:'Smith Tower',x:.395,y:.665,kind:'smith'},
    {name:'Pioneer Square',x:.305,y:.700,kind:'square'},
    {name:'Lumen Field',x:.535,y:.820,kind:'stadium'},
    {name:'Climate Pledge Arena',x:.600,y:.110,kind:'arena'},
    {name:'Amazon Spheres',x:.405,y:.300,kind:'spheres'},
    {name:'Seattle Central Library',x:.505,y:.575,kind:'library'},
    {name:'Seattle Convention Center',x:.720,y:.350,kind:'convention'},
    {name:'King Street Station',x:.420,y:.760,kind:'station'},
    {name:'MoPOP',x:.560,y:.155,kind:'museum'},
    {name:'Colman Dock',x:.145,y:.625,kind:'waterfront'},
    {name:'T-Mobile Park',x:.675,y:.835,kind:'stadium'}
];

const CAR_COLORS=['#f8f7f3','#78828a','#3f5969','#b75f57','#c4aa7b','#4e5356','#80937d'];

export class OperatingMap {
    constructor(canvas,onSelect){
        this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.onSelect=onSelect;
        this.hits=[]; this.dropHover=null; this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.visualState=null; this.civilians=[]; this.spawnSlots=new Map(); this.reportCounts=new Map(); this.pickups=[]; this.trafficAgents=[]; this.trafficSpawnSlots=new Map(); this.congestionState=new Map(); this.trafficLoad=new Map();
        new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
        canvas.addEventListener('pointerup',e=>{const hit=this.hitAt(e.clientX,e.clientY);if(hit)onSelect(hit);});
        canvas.addEventListener('pointermove',e=>{canvas.style.cursor=this.hitAt(e.clientX,e.clientY)?'pointer':'default';});
        this.resize();
    }
    resize(){const r=this.canvas.getBoundingClientRect();this.w=r.width;this.h=r.height;const d=Math.min(devicePixelRatio||1,2);this.canvas.width=this.w*d;this.canvas.height=this.h*d;this.ctx.setTransform(d,0,0,d,0,0);}
    plotHeight(){const strip=document.querySelector('.evac-strip');return Math.max(120,this.h-(strip?.offsetHeight||42)-10);}
    xy(id){const h=this.plotHeight();if(typeof id==='string'&&TOWN_LAYOUT[id])return{x:this.w*TOWN_LAYOUT[id][0],y:h*TOWN_LAYOUT[id][1]};const p=typeof id==='string'?point(id):id;return{x:this.w*(.18+p.y*.19),y:h*(.16+p.x*.205)};}
    hitAt(clientX,clientY){const r=this.canvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;if(x<0||x>this.w||y<0||y>this.plotHeight()+15)return null;return this.hits.slice().reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)||this.hits.filter(h=>h.kind==='block').sort((a,b)=>Math.hypot(x-a.x-a.w/2,y-a.y-a.h/2)-Math.hypot(x-b.x-b.w/2,y-b.y-b.h/2))[0]||null;}
    text(text,x,y,size=10,color='#5f7853',align='center',weight=500){const c=this.ctx;c.font=`${weight} ${size}px "Segoe UI",Arial,sans-serif`;c.textAlign=align;c.fillStyle=color;c.fillText(text,x,y);}
    round(x,y,w,h,r,fill,stroke){const c=this.ctx;c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}

    pathPoint(from,to,t){
        // Always build an edge in one canonical direction. A vehicle traversing
        // the edge backwards samples the same curve in reverse instead of a
        // mirrored curve beside the rendered road.
        const forward=String(from)<=String(to),start=forward?from:to,end=forward?to:from,u=forward?t:1-t;
        const a=this.xy(start),b=this.xy(end),dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy));
        const bendSeed=seeded(`${start}:${end}`,4);
        const sign=bendSeed>.5?1:-1;
        const amplitude=Math.min(18,len*(.065+.045*bendSeed));
        const bend=(Math.sin(u*Math.PI)*amplitude + Math.sin(u*Math.PI*2)*amplitude*.18)*sign;
        return{x:a.x+dx*u-dy/len*bend,y:a.y+dy*u+dx/len*bend};
    }
    line(path,color,width=2,dash=[]){if(!path?.length)return;const c=this.ctx;c.beginPath();const first=this.xy(path[0]);c.moveTo(first.x,first.y);for(let i=1;i<path.length;i++)for(let t=.04;t<=1.001;t+=.04){const p=this.pathPoint(path[i-1],path[i],Math.min(1,t));c.lineTo(p.x,p.y);}c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.setLineDash(dash);c.stroke();c.setLineDash([]);}
    roadClass(a,b){const key=[a,b].sort().join(':');return MAJOR_ROADS.has(key)?'major':SECONDARY_ROADS.has(key)?'secondary':'local';}
    drawRoad(edge){
        const kind=this.roadClass(...edge);
        const widths=kind==='major'?[19,13]:kind==='secondary'?[13,9]:[8,5.5];
        this.line(edge,'#c7c9c8',widths[0]);
        this.line(edge,kind==='major'?'#f9f8f4':'#fbfbf8',widths[1]);
        if(kind==='major')this.line(edge,'#e9b950',1.2,[8,7]);
        if(kind==='secondary')this.line(edge,'#d9d5ca',.8,[3,8]);
    }
    textRotated(text,x,y,angle,size=8,color='#8b8e90',weight=500){const c=this.ctx;c.save();c.translate(x,y);c.rotate(angle);this.text(text,0,0,size,color,'center',weight);c.restore();}

    polygon(points,fill,stroke='#c8c9c5',lineWidth=1){const c=this.ctx;c.beginPath();c.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)c.lineTo(points[i][0],points[i][1]);c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke();}}
    shapePath(w,h,type){
        const c=this.ctx;c.beginPath();
        if(type===0){c.roundRect(-w/2,-h/2,w,h,Math.min(4,w*.12));return;}
        if(type===1){c.moveTo(-w*.5,-h*.5);c.lineTo(w*.34,-h*.5);c.lineTo(w*.5,-h*.20);c.lineTo(w*.5,h*.5);c.lineTo(-w*.5,h*.5);c.closePath();return;}
        if(type===2){c.moveTo(-w*.5,-h*.5);c.lineTo(w*.5,-h*.5);c.lineTo(w*.5,-h*.08);c.lineTo(w*.05,-h*.08);c.lineTo(w*.05,h*.5);c.lineTo(-w*.5,h*.5);c.closePath();return;}
        if(type===3){c.ellipse(0,0,w*.5,h*.5,0,0,TAU);return;}
        if(type===4){c.moveTo(-w*.43,-h*.5);c.lineTo(w*.5,-h*.34);c.lineTo(w*.42,h*.5);c.lineTo(-w*.5,h*.34);c.closePath();return;}
        c.roundRect(-w/2,-h/2,w,h,Math.min(9,w*.22));
    }
    buildingShape(x,y,w,h,color,angle,type,roof=false,height=7){
        const c=this.ctx;
        const depth=Math.max(3,Math.min(25,height));
        const dx=depth*.30,dy=depth*.48;
        const sx=depth*.70,sy=depth*.86;
        c.save();c.translate(x,y);c.rotate(angle);
        // Long soft shadow, proportional to building height.
        c.save();c.translate(sx,sy);c.shadowColor='rgba(74,79,81,.22)';c.shadowBlur=5+depth*.28;c.shadowOffsetX=1.5;c.shadowOffsetY=2.2;
        this.shapePath(w,h,type);c.fillStyle='rgba(83,88,90,.16)';c.fill();c.restore();
        // Extruded wall mass. Keep it flat and clean like Apple Maps 3D.
        c.save();c.translate(dx,dy);this.shapePath(w,h,type);c.fillStyle=shade(color,-24);c.fill();c.strokeStyle='rgba(165,169,169,.30)';c.lineWidth=.55;c.stroke();c.restore();
        // Small side accent gives the extrusion a readable edge without facade clutter.
        c.save();c.translate(dx*.55,dy*.55);this.shapePath(w,h,type);c.fillStyle=shade(color,-12);c.fill();c.restore();
        // Bright roof plane.
        this.shapePath(w,h,type);c.fillStyle=color;c.fill();c.strokeStyle='rgba(255,255,255,.96)';c.lineWidth=.8;c.stroke();
        if(roof){c.fillStyle='rgba(222,224,223,.85)';c.beginPath();c.arc(0,0,Math.min(w,h)*.12,0,TAU);c.fill();}
        c.restore();
    }
    drawBlockBuildings(block,index,state){
        const p=this.xy(block.id),cellW=this.w*.205,cellH=this.plotHeight()*.185,palette=BUILDING_PALETTES[index%BUILDING_PALETTES.length];
        // Buildings live inside four parcels; a broad cross-shaped road reserve stays completely clear.
        const parcels=[[-.292,-.282],[.292,-.282],[-.292,.282],[.292,.282]],row=point(block.id).y;
        const damageAt=82+row*46+seeded(block.id,700)*32;let buildingIndex=0;
        for(let q=0;q<parcels.length;q++){
            const [px,py]=parcels[q];
            const dense=seeded(block.id,q+330);
            const count=dense>.76?2:1;
            for(let m=0;m<count;m++,buildingIndex++){
                const vertical=count===1?0:(m===0?-.082:.082);
                const horizontal=(seeded(block.id,q*31+m+10)-.5)*.020;
                const bx=p.x+cellW*(px+horizontal),by=p.y+cellH*(py+vertical);
                const footprintScale=count===1?1:.76;
                const w=Math.max(14,cellW*((.175+seeded(block.id,buildingIndex*7+1)*.045)*footprintScale));
                const h=Math.max(11,cellH*((.142+seeded(block.id,buildingIndex*7+2)*.045)*footprintScale));
                const warm=seeded(block.id,buildingIndex*19+4)>.84;
                const base=palette[Math.floor(seeded(block.id,buildingIndex*7+5)*palette.length)%palette.length];
                const color=warm?'#eee2c9':base;
                const angle=(seeded(block.id,buildingIndex*7+6)-.5)*.025;
                const roll=seeded(block.id,buildingIndex*7+8),type=roll<.46?0:roll<.60?1:roll<.76?2:roll<.88?4:roll<.95?5:3;
                const tall=seeded(block.id,buildingIndex*7+9);
                const height=6+Math.pow(tall,1.35)*27;
                this.buildingShape(bx,by,w,h,color,angle,type,false,height);
                if(state.time>damageAt+seeded(block.id,buildingIndex*11+13)*22&&seeded(block.id,buildingIndex*17+77)<.38+row*.03){
                    this.drawBuildingCrack(bx,by,w,h,angle,.45+seeded(block.id,buildingIndex*17+88)*.55);
                    if(state.time-damageAt<16)this.drawDebrisBurst(bx,by,seeded(block.id,buildingIndex+940));
                }
            }
        }
        this.hits.push({kind:'block',id:block.id,x:p.x-cellW*.47,y:p.y-cellH*.47,w:cellW*.94,h:cellH*.94});
    }

    drawTerrain(){
        const c=this.ctx,w=this.w,ph=this.plotHeight();
        // Elevation rises away from the waterfront; contour bands keep the base map 2D but give terrain relief.
        const grad=c.createLinearGradient(0,0,0,ph);grad.addColorStop(0,'#e7ece9');grad.addColorStop(.33,'#ecebe5');grad.addColorStop(.68,'#e4e7dc');grad.addColorStop(1,'#d9e2d2');c.fillStyle=grad;c.fillRect(0,0,w,ph);
        c.save();c.globalAlpha=.28;c.strokeStyle='#aeb7a7';c.lineWidth=1;
        for(let i=1;i<=6;i++){const y=ph*(.16+i*.12);c.beginPath();c.moveTo(0,y);c.bezierCurveTo(w*.22,y-9,w*.48,y+10,w*.72,y-5);c.bezierCurveTo(w*.83,y-12,w*.93,y+8,w,y+2);c.stroke();}
        c.restore();
        this.text('LOWER ELEVATION',w*.86,ph*.11,this.w<500?5:7,'#8c9992','center',650);
        this.text('HIGH GROUND',w*.50,ph*.875,this.w<500?6:8,'#74846f','center',750);
    }
    drawParcels(state){
        const c=this.ctx,cellW=this.w*.205,cellH=this.plotHeight()*.185;
        for(const b of state.blocks){const p=this.xy(b.id),tones=['#f1efe9','#e9eee9','#f0ece5','#ebeae5'],parcels=[[-.29,-.27],[.29,-.27],[-.29,.27],[.29,.27]];
            for(let i=0;i<parcels.length;i++){const [ox,oy]=parcels[i],pw=cellW*.38,ph=cellH*.34,x=p.x+ox*cellW-pw/2,y=p.y+oy*cellH-ph/2;c.fillStyle=tones[(point(b.id).x+i)%tones.length];c.strokeStyle='rgba(160,164,158,.28)';c.lineWidth=.65;c.beginPath();c.roundRect(x,y,pw,ph,4);c.fill();c.stroke();
                if(seeded(b.id,i+801)>.24){c.fillStyle='rgba(164,205,132,.42)';c.beginPath();c.roundRect(x+pw*.08,y+ph*.70,pw*.84,ph*.18,ph*.07);c.fill();const trees=1+(seeded(b.id,i+901)>.60?1:0);for(let q=0;q<trees;q++)this.tree(x+pw*(.22+.55*seeded(b.id,i*13+q)),y+ph*(.75+.08*seeded(b.id,i*13+q+4)),1.45+q*.25);}
            }
        }
    }

    drawPark(p){
        const pts=p.points.map(([x,y])=>[x*this.w,y*this.plotHeight()]);
        const xs=pts.map(v=>v[0]),ys=pts.map(v=>v[1]),cx=xs.reduce((a,b)=>a+b,0)/xs.length,cy=ys.reduce((a,b)=>a+b,0)/ys.length;
        const c=this.ctx,grad=c.createLinearGradient(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys));grad.addColorStop(0,'#c5ddb1');grad.addColorStop(1,'#99c18c');
        this.polygon(pts,grad,'#8eb37e',1);
        // layered walking paths
        c.strokeStyle='#f2ead7';c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(xs[0]+8,cy+3);c.bezierCurveTo(cx-24,cy-24,cx+16,cy+20,xs.at(-1)-6,cy-5);c.stroke();
        c.strokeStyle='#ffffffaa';c.lineWidth=1;c.stroke();
        // small pond / hardscape and flower beds
        c.fillStyle='#9bc7cd';c.beginPath();c.ellipse(cx-10,cy+11,10,5,-.25,0,TAU);c.fill();c.strokeStyle='#e9f1e8';c.stroke();
        c.fillStyle='#d58f92';for(let i=0;i<8;i++){c.beginPath();c.arc(cx+18+(i%4)*3,cy-12+Math.floor(i/4)*4,1.2,0,TAU);c.fill();}
        for(let i=0;i<14;i++)this.tree(cx+(seeded(p.name,i)-.5)*Math.min(85,Math.max(...xs)-Math.min(...xs)-12),cy+(seeded(p.name,i+30)-.5)*Math.min(58,Math.max(...ys)-Math.min(...ys)-10),2+(i%4)*.55);
        this.text(p.name,cx,cy+3,Math.max(7,Math.min(10,this.w/105)),'#4f754e','center',700);
    }
    spaceNeedle(x,y,s=1){const c=this.ctx;c.save();c.translate(x,y);c.shadowColor='#36475135';c.shadowBlur=6;c.shadowOffsetY=4;c.strokeStyle='#68757a';c.lineWidth=1.8*s;c.beginPath();c.moveTo(0,17*s);c.lineTo(-3.3*s,-9*s);c.moveTo(0,17*s);c.lineTo(3.3*s,-9*s);c.moveTo(-6*s,10*s);c.lineTo(6*s,10*s);c.stroke();c.fillStyle='#f2efe4';c.strokeStyle='#78858a';c.beginPath();c.ellipse(0,-10*s,10*s,3.7*s,0,0,TAU);c.fill();c.stroke();c.beginPath();c.moveTo(0,-13*s);c.lineTo(0,-23*s);c.stroke();c.restore();}
    landmark(l){
        const x=this.w*l.x,y=this.plotHeight()*l.y,s=this.w<600?.78:1,c=this.ctx;c.save();c.translate(x,y);
        if(l.kind==='needle'){c.restore();this.spaceNeedle(x,y,s);this.text(l.name,x+12,y-15,this.w<500?6:8,'#4d5a60','left',700);return;}
        c.shadowColor='#31404730';c.shadowBlur=5;c.shadowOffsetY=3;
        if(l.kind==='wheel'){
            c.strokeStyle='#557e91';c.lineWidth=1.3;c.beginPath();c.arc(0,0,10*s,0,TAU);c.stroke();for(let i=0;i<8;i++){c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(i*TAU/8)*10*s,Math.sin(i*TAU/8)*10*s);c.stroke();}c.fillStyle='#496878';c.beginPath();c.arc(0,0,2,0,TAU);c.fill();
        }else if(l.kind==='tower'||l.kind==='smith'){
            const ww=(l.kind==='tower'?9:8)*s,hh=(l.kind==='tower'?26:20)*s;c.fillStyle=l.kind==='tower'?'#6c7f88':'#a88d72';c.fillRect(-ww/2,-hh,ww,hh);c.fillStyle='#dce5e6';c.fillRect(-ww*.28,-hh*.86,ww*.56,hh*.13);if(l.kind==='smith'){c.beginPath();c.moveTo(-ww/2,-hh);c.lineTo(0,-hh-7*s);c.lineTo(ww/2,-hh);c.closePath();c.fillStyle='#8c765f';c.fill();}
        }else if(l.kind==='market'){
            c.fillStyle='#b95145';c.fillRect(-11*s,-5*s,22*s,10*s);c.fillStyle='#f0e7d8';c.fillRect(-9*s,-3*s,18*s,3*s);this.text('MARKET',0,2*s,5*s,'#fff','center',800);
        }else if(l.kind==='stadium'||l.kind==='arena'){
            c.fillStyle=l.kind==='arena'?'#9a9c96':'#7b9580';c.beginPath();c.ellipse(0,0,14*s,8*s,0,0,TAU);c.fill();c.fillStyle='#dbe4d7';c.beginPath();c.ellipse(0,0,9*s,4.5*s,0,0,TAU);c.fill();
        }else if(l.kind==='spheres'){
            for(const [dx,dy,r] of [[-6,1,6],[1,-2,7],[7,2,5]]){c.fillStyle='#8db09a';c.beginPath();c.arc(dx*s,dy*s,r*s,0,TAU);c.fill();c.strokeStyle='#dce8df';c.lineWidth=1;c.stroke();}
        }else if(l.kind==='library'){
            c.fillStyle='#96a7ae';c.beginPath();c.moveTo(-11*s,6*s);c.lineTo(-8*s,-8*s);c.lineTo(8*s,-11*s);c.lineTo(12*s,5*s);c.closePath();c.fill();c.strokeStyle='#e6ecee';c.lineWidth=1;c.stroke();
        }else if(l.kind==='convention'){
            c.fillStyle='#adb4b2';c.fillRect(-11*s,-7*s,22*s,14*s);c.fillStyle='#dfe5e2';c.fillRect(-8*s,-4*s,16*s,3*s);
        }else if(l.kind==='station'){
            c.fillStyle='#b79d82';c.fillRect(-10*s,-6*s,20*s,12*s);c.fillStyle='#6c7b74';c.beginPath();c.moveTo(-11*s,-6*s);c.lineTo(0,-11*s);c.lineTo(11*s,-6*s);c.closePath();c.fill();
        }else{
            c.fillStyle=l.kind==='waterfront'?'#4d91b4':l.kind==='museum'?'#8f8171':'#8d806c';c.beginPath();c.arc(0,0,5*s,0,TAU);c.fill();c.strokeStyle='#fff';c.lineWidth=1.5;c.stroke();
        }
        c.restore();this.text(l.name,x+9,y-8,this.w<500?6:8,'#515d61','left',700);
    }
    tree(x,y,r){const c=this.ctx;c.fillStyle='#4c653b25';c.beginPath();c.ellipse(x+2,y+4,r*.9,r*.7,0,0,TAU);c.fill();c.fillStyle='#658a58';c.beginPath();c.arc(x,y,r,0,TAU);c.fill();c.fillStyle='#92b579';c.beginPath();c.arc(x-r*.25,y-r*.26,r*.66,0,TAU);c.fill();c.fillStyle='#b8cc8d';c.beginPath();c.arc(x+r*.22,y-r*.12,r*.35,0,TAU);c.fill();}
    drawBuildingCrack(x,y,w,h,angle,intensity=.5){const c=this.ctx;c.save();c.translate(x,y);c.rotate(angle);c.strokeStyle='rgba(73,60,54,.78)';c.lineWidth=.9+intensity*.8;c.beginPath();c.moveTo(-w*.20,-h*.42);c.lineTo(-w*.08,-h*.12);c.lineTo(-w*.16,h*.02);c.lineTo(-w*.01,h*.28);c.lineTo(-w*.10,h*.46);c.moveTo(w*.06,-h*.18);c.lineTo(-w*.03,-h*.02);c.lineTo(w*.08,h*.10);c.stroke();c.restore();}
    drawDebrisBurst(x,y,seed){const c=this.ctx;c.save();c.globalAlpha=.52;c.fillStyle='#80766e';for(let i=0;i<6;i++){const a=seed*TAU+i*.92,r=5+i*1.8;c.beginPath();c.arc(x+Math.cos(a)*r,y+Math.sin(a)*r*.55,1+(i%2)*.55,0,TAU);c.fill();}c.restore();}

    civilianDot(x,y,panic=false,alpha=1,injured=false){
        const c=this.ctx;c.globalAlpha=alpha;c.fillStyle=injured?'#9f2f2a':panic?'#cf5c4e':'#405861';c.beginPath();c.arc(x,y,injured?2.3:panic?2.05:1.65,0,TAU);c.fill();
        if(panic&&!injured){c.strokeStyle='#fff9';c.lineWidth=.55;c.stroke();}c.globalAlpha=1;
    }
    normFor(id){return TOWN_LAYOUT[id]||[.5,.5];}
    visualNeighbors(id){
        if(id.startsWith('S'))return [];
        const p=point(id),out=[];
        for(const [candidate] of Object.entries(TOWN_LAYOUT)){
            if(candidate.startsWith('S'))continue;const q=point(candidate);
            if(Math.abs(q.x-p.x)+Math.abs(q.y-p.y)===1)out.push(candidate);
        }
        return out;
    }
    nearestShelter(blockId,state=this.visualState){
        const plan=state?evacuationPlan(state,blockId):null;
        if(plan)return plan.shelter.id;
        const here=this.normFor(blockId),shelters=(state?.shelters||[]).map(s=>s.id).filter(id=>TOWN_LAYOUT[id]);
        return shelters.sort((a,b)=>Math.hypot(this.normFor(a)[0]-here[0],this.normFor(a)[1]-here[1])-Math.hypot(this.normFor(b)[0]-here[0],this.normFor(b)[1]-here[1]))[0]||'S2';
    }
    wanderingPath(blockId,key,wrongWay=false){
        const shelter=this.nearestShelter(blockId);
        let base=route(this.visualState||{closedRoads:[]},blockId,shelter)||[blockId,shelter];
        base=[...base];
        if(wrongWay&&base.length>2){
            const current=blockId;
            let sideChoices=this.visualNeighbors(current).filter(n=>point(n).y>=point(current).y-1);
            sideChoices=sideChoices.filter(n=>n!==base[1]);
            const detour=sideChoices[Math.floor(seeded(key,61)*Math.max(1,sideChoices.length))];
            if(detour)base.splice(1,0,detour);
        }
        if(base.length>2&&seeded(key,62)>.55){
            const idx=Math.min(base.length-2,1+Math.floor(seeded(key,63)*(base.length-2)));
            const pivot=base[idx];
            const lateral=this.visualNeighbors(pivot).filter(n=>point(n).y>=point(pivot).y&&n!==base[idx+1]&&n!==base[idx-1]);
            if(lateral.length&&seeded(key,64)>.5)base.splice(idx+1,0,lateral[Math.floor(seeded(key,65)*lateral.length)]);
        }
        return base;
    }
    civilianOrigin(b,key){
        const base=this.normFor(b.id),cellX=.205,cellY=.185;
        const usePark=seeded(key,120)>.78;
        if(usePark){
            const candidates=PARKS.map(p=>{const cx=p.points.reduce((s,v)=>s+v[0],0)/p.points.length,cy=p.points.reduce((s,v)=>s+v[1],0)/p.points.length;return {p,cx,cy,d:Math.hypot(cx-base[0],cy-base[1])};}).sort((a,b)=>a.d-b.d);
            if(candidates[0]?.d<.26){const q=candidates[0];return [q.cx+(seeded(key,121)-.5)*.055,q.cy+(seeded(key,122)-.5)*.045];}
        }
        // Spawn from one of the parcel interiors, so pedestrians visibly emerge from buildings instead of road junctions.
        const parcel=[[-.292,-.282],[.292,-.282],[-.292,.282],[.292,.282]][Math.floor(seeded(key,123)*4)%4];
        return [base[0]+parcel[0]*cellX+(seeded(key,124)-.5)*.025,base[1]+parcel[1]*cellY+(seeded(key,125)-.5)*.020];
    }
    ambientPedestrianPath(state,blockId,key){
        // Civilian street flow follows the same reachable-hub rule as engine.js.
        // These ambient dots are still visual density (they do not create population),
        // but they now move inland toward a real reception hub instead of wandering.
        const plan=evacuationPlan(state,blockId);
        if(!plan)return {path:[blockId],destination:null};
        return {path:plan.path,destination:plan.shelter.id};
    }
    spawnCivilian(state,b,slot){
        const key=`${b.id}:${slot}`;const panic=seeded(key,1)>.70;
        const movement=this.ambientPedestrianPath(state,b.id,key),path=movement.path;
        const start=this.civilianOrigin(b,key);
        this.civilians.push({key,block:b.id,born:state.time,start,path,panic,wrong:false,destination:movement.destination,speed:.210+seeded(key,9)*.055,phase:seeded(key,10),local:seeded(key,71)>.90,life:44+seeded(key,11)*34});
    }
    syncCivilians(state){
        if(this.visualState!==state){this.visualState=state;this.civilians=[];this.spawnSlots.clear();this.reportCounts.clear();this.pickups=[];this.trafficAgents=[];this.trafficSpawnSlots.clear();this.congestionState.clear();this.trafficLoad.clear();}
        if(!state.started)return;
        for(const b of state.blocks){
            if(submerged(state,b.id)||!b.walkers||!evacuationPlan(state,b.id))continue;
            const cadence=1.55+seeded(b.id,333)*1.15,slot=Math.floor(Math.max(0,state.time-.35)/cadence),last=this.spawnSlots.get(b.id)??-1;
            if(slot>last){
                for(let n=last+1;n<=slot&&this.civilians.length<270;n++)this.spawnCivilian(state,b,n);
                this.spawnSlots.set(b.id,slot);
            }
        }
        this.civilians=this.civilians.filter(a=>state.time-a.born<a.life||a.destination);
        if(this.civilians.length>285)this.civilians.splice(0,this.civilians.length-285);
        for(const e of state.events){
            const current=e.rescued||0,previous=this.reportCounts.get(e.id)||0;
            if(current>previous){for(let i=0;i<Math.min(8,current-previous);i++)this.pickups.push({block:e.truth.block,born:state.time,seed:seeded(e.id,700+i)});}
            this.reportCounts.set(e.id,current);
        }
        this.pickups=this.pickups.filter(p=>state.time-p.born<3.4);
    }
    civilianPosition(agent,state){
        const age=Math.max(0,state.time-agent.born),emerge=1.8;
        const end=this.xy(agent.block),start={x:this.w*agent.start[0],y:this.plotHeight()*agent.start[1]};
        if(age<emerge){const t=clamp01(age/emerge),e=t*t*(3-2*t);return{x:start.x+(end.x-start.x)*e,y:start.y+(end.y-start.y)*e,alpha:1};}
        if(!agent.path?.length)return{x:end.x,y:end.y,alpha:1};
        const movement=(age-emerge)*agent.speed,segments=Math.max(1,agent.path.length-1);let progress;
        if(agent.destination){progress=movement/segments;if(progress>=1)return{x:this.xy(agent.destination).x,y:this.xy(agent.destination).y,alpha:Math.max(0,1-(progress-1)*4),done:progress>1.25};}
        else{const cycle=(movement%2);progress=cycle<=1?cycle:2-cycle;}
        const p=this.along(agent.path,clamp01(progress));
        let x=p.x,y=p.y;
        // A minority use parallel local streets / alleys instead of the main evacuation corridor.
        if(agent.local){x+=Math.sin(agent.phase*TAU)*6.5;y+=Math.cos(agent.phase*TAU)*3.0;}
        if(agent.panic&&!this.reducedMotion){x+=Math.sin(state.time*3.8+agent.phase*TAU)*4.8;y+=Math.cos(state.time*4.8+agent.phase*TAU)*3.4;}
        return{x,y,alpha:1};
    }
    drawCivilians(state,now){
        const survivors=[],front=this.floodFrontY(state);
        for(const a of this.civilians){const p=this.civilianPosition(a,state);if(p.done||p.y<front+3)continue;this.civilianDot(p.x,p.y,a.panic,p.alpha);survivors.push(a);}this.civilians=survivors;
        for(const pickup of this.pickups){
            const age=state.time-pickup.born,t=clamp01(age/3.2),source=this.xy(pickup.block);
            const unit=state.units.find(u=>u.trip&&u.cargo>0)||state.units.find(u=>u.trip&&u.status==='return');
            const target=unit?.trip?this.along(unit.trip.path,clamp01((state.time-unit.trip.started)/(unit.trip.ends-unit.trip.started))):{x:source.x+18,y:source.y+12};
            const x=source.x+(target.x-source.x)*t+(pickup.seed-.5)*10,y=source.y+(target.y-source.y)*t+Math.sin(t*Math.PI)*-7;
            this.civilianDot(x,y,false,1-t*.55);
        }
    }
    drawReportedCrowds(state,now){
        for(const e of state.events){
            if(e.status==='pending'||e.truth.duplicateOf||!e.truth.people||state.time<e.at)continue;
            const left=Math.max(0,e.truth.people-e.rescued-e.lost);if(!left||submerged(state,e.truth.block))continue;
            const p=this.xy(e.truth.block),n=Math.min(9,Math.max(2,Math.ceil(left/3)));
            for(let i=0;i<n;i++){
                const r=8+(i%4)*2.6,ang=(i/n)*TAU+seeded(e.id,i)*.7,panic=i%3===0,wobble=panic&&!this.reducedMotion?Math.sin(now*.004+i)*3.2:0;
                this.civilianDot(p.x+Math.cos(ang)*(r+wobble),p.y+9+Math.sin(ang)*(r*.52)+wobble*.2,panic,.92);
            }
        }
    }
    drawConvoys(state){
        for(const convoy of state.convoys.filter(v=>!v.done)){
            const base=clamp01((state.time-convoy.started)/(convoy.arrives-convoy.started));
            for(let i=0;i<convoy.people;i++){const p=this.along(convoy.path,clamp01(base-i*.018));if(p.y<this.floodFrontY(state)+3)continue;this.civilianDot(p.x+(i%2?2:-2),p.y+(i%3-1)*2,false,.96);}
        }
    }
    floodFrontY(state){const logical=floodRow(state),progress=clamp01((logical+1.1)/4.75);return this.plotHeight()*(.018+progress*.845);}
    graphEdges(state){const edges=[];for(const b of state.blocks){const p=point(b.id);if(p.x<3)edges.push([b.id,String.fromCharCode(66+p.x)+(p.y+1)]);if(p.y<3)edges.push([b.id,String.fromCharCode(65+p.x)+(p.y+2)]);}edges.push(['A4','S1'],['B4','S2'],['C4','S2'],['D4','S3'],['A3','S4']);return edges;}
    edgeFlooded(state,edge){return submerged(state,edge[0])||submerged(state,edge[1]);}
    evacDirection(edge){
        const a=this.normFor(edge[0]),b=this.normFor(edge[1]);
        if(Math.abs(a[1]-b[1])>.015)return a[1]<b[1]?1:-1;
        const mx=(a[0]+b[0])*.5;
        const shelters=(this.visualState?.shelters||[]).map(s=>s.id).filter(id=>TOWN_LAYOUT[id]).map(id=>({id,x:this.normFor(id)[0]})).sort((m,n)=>Math.abs(m.x-mx)-Math.abs(n.x-mx));
        const target=shelters[0].x;
        return Math.abs(a[0]-target)<=Math.abs(b[0]-target)?-1:1;
    }
    edgeCongestion(state,edge){
        const key=[...edge].sort().join(':');
        const incident=state.roadIncidents.find(r=>r.status!=='pending'&&r.status!=='cleared'&&[...r.edge].sort().join(':')===key);
        let load=incident?.kind==='congestion'?0.72:incident?.kind==='collision'?0.56:incident?.kind==='collapse'?0.66:0.14;
        const a=point(edge[0]),b=point(edge[1]);
        for(const convoy of state.convoys.filter(v=>!v.done)){
            for(let i=1;i<convoy.path.length;i++){
                const x=point(convoy.path[i-1]),y=point(convoy.path[i]);
                if((x.x===a.x&&x.y===a.y&&y.x===b.x&&y.y===b.y)||(x.x===b.x&&x.y===b.y&&y.x===a.x&&y.y===a.y))load+=0.16;
            }
        }
        const adjacent=[edge[0],edge[1]].map(id=>state.blocks.find(b=>b.id===id)).filter(Boolean);
        load+=adjacent.reduce((sum,b)=>sum+Math.min(0.18,(b.walkers||0)/80),0);
        // Vehicles physically occupying the street. This is the term that makes
        // relief real: when cars reroute, the number genuinely falls and the
        // colour follows, instead of a timer pretending the jam went away.
        load+=Math.min(.34,(this.trafficLoad.get(key)||0)*.085);
        const raw=clamp01(load);
        // Hysteresis rather than a timer. A street is flagged jammed above RED and
        // stays flagged until diverted traffic pulls it back under CLEAR. A jam
        // held up by a road incident never clears itself -- the base load alone
        // sits above CLEAR, so a ground crew still has to open the lane.
        const RED=.68,CLEAR=.52,MIN_HOLD=4,jam=this.congestionState.get(key);
        if(raw>=RED){if(jam)jam.incident=!!incident;else this.congestionState.set(key,{since:state.time,incident:!!incident});}
        // MIN_HOLD keeps the diversion pointed away long enough for the street to
        // actually drain; without it the jam clears the instant the first cars
        // leave and the traffic pours straight back in.
        else if(jam&&raw<CLEAR&&state.time-jam.since>=MIN_HOLD)this.congestionState.delete(key);
        return raw;
    }
    edgeIsJammed(edge){return this.congestionState.has([...edge].sort().join(':'));}
    avoidCongestionPath(state,from,to){
        // A lightweight, display-only reroute: same block graph as graphEdges(),
        // but skipping streets currently shown red so decorative traffic visibly
        // spills onto the open (yellow) streets instead. Falls back to null if no
        // detour exists, so the caller can keep the original route.
        if(from===to)return [from];
        const neighbors=new Map();
        for(const [x,y] of this.graphEdges(state)){
            const key=[x,y].sort().join(':');
            if(this.edgeFlooded(state,[x,y])||state.closedRoads.includes(key)||this.edgeIsJammed([x,y]))continue;
            (neighbors.get(x)||neighbors.set(x,[]).get(x)).push(y);
            (neighbors.get(y)||neighbors.set(y,[]).get(y)).push(x);
        }
        const queue=[[from]],visited=new Set([from]);
        while(queue.length){
            const path=queue.shift();
            for(const next of neighbors.get(path.at(-1))||[]){
                if(visited.has(next))continue;
                if(next===to)return [...path,next];
                visited.add(next);queue.push([...path,next]);
            }
        }
        return null;
    }
    drawEdgeCongestionOverlay(state,edge){const load=this.edgeCongestion(state,edge);if(load<.12)return;const width=this.roadClass(...edge)==='major'?13:this.roadClass(...edge)==='secondary'?9.5:6.5;const stops=load<.38?[[244,212,69],[239,172,51],load/.38]:load<.68?[[239,172,51],[224,97,46],(load-.38)/.30]:[[224,97,46],[178,39,38],(load-.68)/.32];const rgb=stops[0].map((v,i)=>Math.round(v+(stops[1][i]-v)*clamp01(stops[2])));this.line(edge,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${.38+load*.42})`,width);this.line(edge,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${.22+load*.34})`,Math.max(2.5,width*.52));}
    drawTinyVehicle(p,angle,color,ambulance=false,scale=1){
        const c=this.ctx;c.save();c.translate(p.x,p.y);c.rotate(angle);c.shadowColor='#30353a30';c.shadowBlur=3;c.shadowOffsetY=2;
        this.round(-5.5*scale,-2.7*scale,11*scale,5.4*scale,1.5*scale,ambulance?'#fffdf7':color,'#52585a80');c.shadowColor='transparent';
        c.fillStyle=ambulance?'#d33d37':'#d9e1e2';c.fillRect(-1.8*scale,-2.15*scale,4.5*scale,1.3*scale);
        if(ambulance){c.fillStyle='#d43d37';c.fillRect(-.7*scale,-2.5*scale,1.4*scale,5*scale);c.fillRect(-2.5*scale,-.7*scale,5*scale,1.4*scale);}
        c.fillStyle='#333b3c';c.beginPath();c.arc(-3.3*scale,3*scale,1.1*scale,0,TAU);c.arc(3.2*scale,3*scale,1.1*scale,0,TAU);c.fill();c.restore();
    }
    carRoute(state,source,key){
        // Civilian traffic is evacuation traffic: stay on roads and head toward the
        // same reachable reception hubs used by walking evacuation.
        const plan=evacuationPlan(state,source);
        if(!plan?.path?.length||plan.path.length<2)return null;
        const jammed=plan.path.some((p,i)=>i&&this.edgeIsJammed([plan.path[i-1],p]));
        if(!jammed)return plan.path;
        // The direct route is currently shown red; spill this car onto another
        // open street toward the same shelter instead of sitting in the jam.
        const detour=this.avoidCongestionPath(state,source,plan.shelter.id);
        return detour||plan.path;
    }
    syncTraffic(state){
        const sources=['A1','B1','C1','D1','A2','B2','C2','D2','A3','B3','C3','D3'];
        for(const source of sources){
            if(submerged(state,source))continue;
            const cadence=1.45+seeded(source,401)*1.20,slot=Math.floor(Math.max(0,state.time)/cadence),last=this.trafficSpawnSlots.get(source)??-1;
            if(slot>last){
                for(let n=last+1;n<=slot&&this.trafficAgents.length<115;n++){
                    const key=`car:${source}:${n}`,path=this.carRoute(state,source,key);
                    if(!path?.length||path.length<2)continue;
                    // The factor is converted to pixels per segment so a car that turns
                    // from a wide road onto a narrow road still stays on the carriageway.
                    this.trafficAgents.push({
                        key,source,path,born:state.time,
                        laneFactor:(seeded(key,402)-.5)*2,
                        entry:.015+seeded(key,403)*.055,
                        speed:.130+seeded(key,405)*.050,
                        color:CAR_COLORS[Math.floor(seeded(key,406)*CAR_COLORS.length)%CAR_COLORS.length]
                    });
                }
                this.trafficSpawnSlots.set(source,slot);
            }
        }
        this.trafficAgents=this.trafficAgents.filter(car=>state.time-car.born<55);
        if(this.trafficAgents.length>125)this.trafficAgents.splice(0,this.trafficAgents.length-125);
    }
    carProgress(car,state){const segs=Math.max(1,car.path.length-1);return car.entry+(Math.max(0,state.time-car.born)*car.speed)/segs;}
    carSegment(car,state){
        // The [from,to] street the car is on right now, or null once it has arrived.
        const progress=this.carProgress(car,state);
        if(progress>=1)return null;
        const segs=Math.max(1,car.path.length-1),i=Math.min(car.path.length-2,Math.floor(clamp01(progress)*segs));
        return [car.path[i],car.path[i+1]];
    }
    remainingEdges(car,state){
        // Streets the car has not driven yet, so we only reroute around a jam that
        // is still ahead of it.
        const progress=this.carProgress(car,state);
        if(progress>=1)return [];
        const segs=Math.max(1,car.path.length-1),from=Math.min(car.path.length-2,Math.floor(clamp01(progress)*segs)),edges=[];
        for(let i=from;i<car.path.length-1;i++)edges.push([car.path[i],car.path[i+1]]);
        return edges;
    }
    divertCar(car,state){
        // Send a car that is already moving around the jam, starting from the next
        // intersection it reaches. Its position on the current street is preserved
        // so the reroute reads as a turn, not a teleport.
        const segs=Math.max(1,car.path.length-1),progress=clamp01(this.carProgress(car,state)),scaled=progress*segs;
        const i=Math.min(car.path.length-2,Math.floor(scaled)),within=scaled-Math.floor(scaled);
        const destination=car.path.at(-1),junction=car.path[i+1];
        if(junction===destination)return false;
        const detour=this.avoidCongestionPath(state,junction,destination);
        if(!detour||detour.length<2)return false;
        const path=[car.path[i],...detour];
        car.path=path;car.born=state.time;car.entry=within/Math.max(1,path.length-1);car.divertedAt=state.time;
        return true;
    }
    trafficPosition(car,state){
        const segs=Math.max(1,car.path.length-1);
        const progress=this.carProgress(car,state);
        if(progress>=1)return {...this.xy(car.path.at(-1)),angle:Math.PI/2,done:true};
        const clamped=clamp01(progress),segmentPosition=Math.min(.999999,clamped)*segs,segment=Math.floor(segmentPosition);
        const roadKind=this.roadClass(car.path[segment],car.path[Math.min(segment+1,car.path.length-1)]);
        const laneMax=roadKind==='major'?2.4:roadKind==='secondary'?1.6:.8,lane=(car.laneFactor??0)*laneMax;
        const p=this.along(car.path,clamped),p2=this.along(car.path,clamp01(Math.min(.999,progress+.008)));
        const angle=Math.atan2(p2.y-p.y,p2.x-p.x),normal=angle+Math.PI/2;
        return {
            x:p.x+Math.cos(normal)*lane,
            y:p.y+Math.sin(normal)*lane,
            angle,done:false
        };
    }
    drawCongestionQueue(state,edge){
        // Only a jam pinned by a road incident keeps a standing queue. A pure
        // traffic jam is drained by diversion, so drawing phantom stopped cars on
        // it would contradict the street we just emptied.
        const key=[...edge].sort().join(':'),jam=this.congestionState.get(key);
        if(!jam?.incident)return;
        const laneMax=this.roadClass(...edge)==='major'?2.4:this.roadClass(...edge)==='secondary'?1.6:.8,count=6;
        for(let i=0;i<count;i++){
            const t=Math.min(.95,.28+i*.115),p=this.pathPoint(edge[0],edge[1],t),p2=this.pathPoint(edge[0],edge[1],Math.min(.999,t+.01));
            const angle=Math.atan2(p2.y-p.y,p2.x-p.x),normal=angle+Math.PI/2,lane=(seeded(key,910+i)-.5)*laneMax;
            this.drawTinyVehicle({x:p.x+Math.cos(normal)*lane,y:p.y+Math.sin(normal)*lane},angle,CAR_COLORS[(i+2)%CAR_COLORS.length],false,.72);
        }
    }
    measureTrafficLoad(state){
        // Count the cars sitting on each street before the congestion values are
        // recomputed, so the colour reflects this frame's actual occupancy.
        this.trafficLoad.clear();
        for(const car of this.trafficAgents){
            const seg=this.carSegment(car,state);
            if(!seg)continue;
            const key=[...seg].sort().join(':');
            this.trafficLoad.set(key,(this.trafficLoad.get(key)||0)+1);
        }
    }
    relieveCongestion(state){
        // Actually thin out the jammed streets: cars still heading into a jam turn
        // off onto an open route. A per-frame budget drains the backlog gradually
        // instead of emptying the street in a single frame, and the two-second
        // cooldown stops a car ping-ponging as loads shift behind it.
        let budget=3;
        for(const car of this.trafficAgents){
            if(budget<=0)break;
            if(state.time-(car.divertedAt??-99)<2)continue;
            if(!this.remainingEdges(car,state).some(edge=>this.edgeIsJammed(edge)))continue;
            if(this.divertCar(car,state))budget--;
        }
    }
    drawTraffic(state){
        const edges=this.graphEdges(state);
        this.measureTrafficLoad(state);
        for(const edge of edges){if(this.edgeFlooded(state,edge))continue;this.drawEdgeCongestionOverlay(state,edge);}
        this.relieveCongestion(state);
        this.syncTraffic(state);
        const survivors=[];
        for(const car of this.trafficAgents){
            const pos=this.trafficPosition(car,state);
            if(pos.done)continue;
            // Never draw normal road traffic inside inundated water.
            if(pos.y<this.floodFrontY(state)+4)continue;
            if(this.remainingEdges(car,state).some(edge=>this.edgeFlooded(state,edge)))continue;
            this.drawTinyVehicle({x:pos.x,y:pos.y},pos.angle,car.color,false,.78);
            survivors.push(car);
        }
        this.trafficAgents=survivors;
        for(const edge of edges){if(this.edgeFlooded(state,edge))continue;this.drawCongestionQueue(state,edge);}
    }
    drawRoadDamage(state){
        const c=this.ctx;
        for(const incident of state.roadIncidents.filter(r=>r.status!=='pending'&&r.status!=='cleared')){
            const mid=this.pathPoint(...incident.edge,.5),a=this.pathPoint(...incident.edge,.44),b=this.pathPoint(...incident.edge,.56),angle=Math.atan2(b.y-a.y,b.x-a.x),normal=angle+Math.PI/2;
            if(incident.kind==='collapse'||incident.kind==='collision'){
                c.strokeStyle=incident.kind==='collapse'?'#4e423a':'#7d6253';c.lineWidth=2.1;c.beginPath();
                for(let i=-4;i<=4;i++){const k=i/4,baseX=mid.x+Math.cos(normal)*k*12,baseY=mid.y+Math.sin(normal)*k*12,zig=(i%2?3.4:-2.4);if(i===-4)c.moveTo(baseX,baseY);else c.lineTo(baseX+Math.cos(angle)*zig,baseY+Math.sin(angle)*zig);}c.stroke();
                c.strokeStyle='rgba(255,255,255,.20)';c.lineWidth=.8;c.beginPath();
                for(let i=-3;i<=3;i++){const k=i/3,baseX=mid.x+Math.cos(normal)*k*10,baseY=mid.y+Math.sin(normal)*k*10,zig=(i%2?2.2:-1.5);if(i===-3)c.moveTo(baseX+1,baseY+1);else c.lineTo(baseX+Math.cos(angle)*zig+1,baseY+Math.sin(angle)*zig+1);}c.stroke();
                if(incident.kind==='collapse'){for(let i=0;i<7;i++){c.fillStyle='#6f6258';c.beginPath();c.arc(mid.x+(seeded(incident.id,i)-.5)*24,mid.y+(seeded(incident.id,i+10)-.5)*16,1.5+(i%3)*.7,0,TAU);c.fill();}}
            }
            if(incident.kind==='collision'){
                const p={x:mid.x+Math.cos(normal)*5,y:mid.y+Math.sin(normal)*5};this.drawTinyVehicle(p,angle+.7,'#b05b50',false,1.05);
            }
        }
    }
    drawVisualDisasters(state,now){
        const c=this.ctx,front=this.floodFrontY(state);
        const events=[
            {kind:'building',id:'B1',lead:78,seed:11},{kind:'road',edge:['A2','B2'],lead:70,seed:22},
            {kind:'crash',edge:['C2','C3'],lead:64,seed:33},{kind:'casualty',id:'D2',lead:56,seed:44},
            {kind:'building',id:'A3',lead:74,seed:55},{kind:'road',edge:['D3','D4'],lead:62,seed:66},
            {kind:'crash',edge:['B3','B4'],lead:58,seed:77},{kind:'casualty',id:'C3',lead:50,seed:88},
            {kind:'building',id:'C4',lead:72,seed:99},{kind:'road',edge:['A4','B4'],lead:54,seed:110}
        ];
        for(const e of events){
            const anchor=e.edge?this.pathPoint(e.edge[0],e.edge[1],.52):this.xy(e.id);
            const triggerY=anchor.y-e.lead;
            if(front<triggerY)continue;
            const age=Math.max(0,(front-triggerY)/Math.max(8,this.plotHeight()*.010));
            const burst=age<2.8?1-age/2.8:0;
            const pulse=burst&&!this.reducedMotion?1+Math.sin(age*8)*.10:1;
            const submergedHere=anchor.y<front-8;
            if(submergedHere&&e.kind!=='building'&&e.kind!=='road')continue;

            // A short dust/spray burst makes the failure feel sudden instead of permanently stamped on the map.
            if(burst>0){
                c.save();c.globalAlpha=.40*burst;
                for(let i=0;i<8;i++){
                    const a=seeded(e.seed,i)*TAU,r=(8+seeded(e.seed,i+20)*20)*(1-burst*.35);
                    c.fillStyle=i%3===0?'#d8d0c4':'#8f8378';c.beginPath();c.arc(anchor.x+Math.cos(a)*r,anchor.y+Math.sin(a)*r*.55,1.2+seeded(e.seed,i+40)*2.2,0,TAU);c.fill();
                }
                c.restore();
            }

            if(e.kind==='building'){
                c.save();c.translate(anchor.x+10,anchor.y-9);c.scale(pulse,pulse);
                // displaced facade / roof fragment
                c.fillStyle='rgba(82,73,67,.13)';c.beginPath();c.ellipse(4,7,19,7,-.16,0,TAU);c.fill();
                c.fillStyle='#aaa098';c.beginPath();c.moveTo(-12,-7);c.lineTo(-1,-13);c.lineTo(8,-6);c.lineTo(4,5);c.lineTo(-8,4);c.closePath();c.fill();
                c.strokeStyle='#55463f';c.lineWidth=2.2;c.beginPath();c.moveTo(-13,-14);c.lineTo(-6,-5);c.lineTo(-10,2);c.lineTo(-1,10);c.lineTo(6,2);c.lineTo(13,8);c.stroke();
                c.strokeStyle='#6c5950';c.lineWidth=1.2;c.beginPath();c.moveTo(0,-10);c.lineTo(3,-3);c.lineTo(-1,2);c.lineTo(5,7);c.stroke();
                for(let i=0;i<8;i++){c.fillStyle=i%2?'#746b64':'#9a9087';c.beginPath();c.arc(-15+i*4,10+(i%3)*2,1.3+(i%3)*.55,0,TAU);c.fill();}
                c.restore();
            }

            if(e.kind==='road'){
                const a=this.pathPoint(e.edge[0],e.edge[1],.43),b=this.pathPoint(e.edge[0],e.edge[1],.61),ang=Math.atan2(b.y-a.y,b.x-a.x),nrm=ang+Math.PI/2;
                c.save();c.strokeStyle='#332d2a';c.lineWidth=3.2;c.beginPath();
                for(let i=-5;i<=5;i++){
                    const k=i/5,x=anchor.x+Math.cos(nrm)*k*15,y=anchor.y+Math.sin(nrm)*k*15,j=(i%2?4.2:-3.1);
                    if(i===-5)c.moveTo(x,y);else c.lineTo(x+Math.cos(ang)*j,y+Math.sin(ang)*j);
                }c.stroke();
                c.strokeStyle='rgba(255,255,255,.28)';c.lineWidth=.9;c.translate(1.2,1.2);c.stroke();c.translate(-1.2,-1.2);
                // broken asphalt slabs
                for(let i=0;i<5;i++){const off=(i-2)*5;c.fillStyle=i%2?'#74706b':'#8a8580';c.save();c.translate(anchor.x+Math.cos(nrm)*off+Math.cos(ang)*(i%2?5:-4),anchor.y+Math.sin(nrm)*off+Math.sin(ang)*(i%2?5:-4));c.rotate(ang+(i-2)*.16);c.fillRect(-3,-2,6,4);c.restore();}
                c.restore();
            }

            if(e.kind==='crash'){
                const a=this.pathPoint(e.edge[0],e.edge[1],.45),b=this.pathPoint(e.edge[0],e.edge[1],.59),ang=Math.atan2(b.y-a.y,b.x-a.x);
                // skid marks
                c.strokeStyle='rgba(50,48,46,.58)';c.lineWidth=1.6;c.beginPath();c.moveTo(anchor.x-22*Math.cos(ang),anchor.y-22*Math.sin(ang));c.quadraticCurveTo(anchor.x-8,anchor.y-7,anchor.x-3,anchor.y);c.stroke();
                this.drawTinyVehicle({x:anchor.x-5,y:anchor.y-1},ang+.58,'#a64e48',false,1.04);
                this.drawTinyVehicle({x:anchor.x+7,y:anchor.y+4},ang-2.28,'#d9d7d0',false,.98);
                // light gray smoke plume
                c.save();c.globalAlpha=.52;for(let i=0;i<5;i++){const rise=Math.min(age*3,18)+i*4;c.fillStyle=i%2?'#b9b6b0':'#d0ccc4';c.beginPath();c.arc(anchor.x+6+Math.sin(now*.001+i)*3,anchor.y-rise,3.8+i*.8,0,TAU);c.fill();}c.restore();
            }

            if(e.kind==='casualty'){
                c.save();c.translate(anchor.x,anchor.y+8);
                for(let i=0;i<3;i++){
                    c.save();c.translate(-10+i*10,(i%2)*4);c.rotate(-.45+i*.28);
                    c.strokeStyle='#7c2927';c.lineWidth=1.5;c.beginPath();c.arc(-3,-2,1.8,0,TAU);c.moveTo(-1,-1);c.lineTo(4,1);c.lineTo(7,4);c.moveTo(1,0);c.lineTo(-2,4);c.stroke();c.restore();
                }
                c.fillStyle='rgba(178,54,47,.14)';c.beginPath();c.ellipse(0,7,19,6,0,0,TAU);c.fill();c.restore();
            }
        }
    }
    casualtySites(state){
        const sites=[];for(const b of state.blocks)if(b.lost)sites.push([b.id,b.lost]);for(const e of state.events)if(!e.truth.duplicateOf&&e.lost)sites.push([e.truth.block,e.lost]);return sites;
    }
    drawCasualties(state){
        const c=this.ctx;for(const [id,count] of this.casualtySites(state)){
            if(submerged(state,id))continue;
            const base=this.xy(id),n=Math.min(4,Math.max(1,Math.ceil(count/6)));
            for(let i=0;i<n;i++){
                const x=base.x-14+i*8+(seeded(id,i+800)-.5)*4,y=base.y+14+(i%2)*6;
                c.save();c.translate(x,y);c.rotate((seeded(id,i+820)-.5)*.8);
                c.fillStyle='rgba(162,47,43,.24)';c.beginPath();c.ellipse(0,2,5.6,2.8,0,0,TAU);c.fill();
                c.strokeStyle='#8f2e2a';c.lineWidth=1.1;c.beginPath();c.moveTo(-3,-1);c.lineTo(2,1);c.lineTo(5,3);c.moveTo(0,-2);c.lineTo(-2,3);c.moveTo(-1,1);c.lineTo(-4,4);c.stroke();
                c.restore();
            }
            c.fillStyle='#fff';c.strokeStyle='#c33b35';c.lineWidth=1;c.beginPath();c.arc(base.x+18,base.y+17,5.5,0,TAU);c.fill();c.stroke();c.fillStyle='#c33b35';c.fillRect(base.x+16.4,base.y+13,3.2,8);c.fillRect(base.x+14,base.y+15.4,8,3.2);
        }
    }
    drawAmbulances(state){
        if(state.time<65)return;const targets=this.casualtySites(state).map(x=>x[0]).filter(id=>!submerged(state,id));
        if(!targets.length)for(const e of state.events.filter(e=>e.status!=='pending'&&e.truth.severity==='high'&&e.truth.people>e.rescued+e.lost&&!submerged(state,e.truth.block)))targets.push(e.truth.block);
        if(!targets.length)return;
        for(let i=0;i<Math.min(1,targets.length);i++){
            const home=i?'S3':'S1',target=targets[i%targets.length],path=route(state,home,target)||[home,target],phase=(state.time*.018+i*.47)%2,t=phase<=1?phase:2-phase,p=this.along(path,t),p2=this.along(path,clamp01(t+.012*(phase<=1?1:-1))),angle=Math.atan2(p2.y-p.y,p2.x-p.x);
            this.drawTinyVehicle(p,angle,'#ffffff',true,1.08);
        }
    }

    draw(state,now){
        const c=this.ctx,w=this.w,h=this.h,ph=this.plotHeight();if(!w||!h)return;
        this.lastTime=state.time;this.hits=[];c.clearRect(0,0,w,h);
        c.fillStyle='#edece5';c.fillRect(0,0,w,h);
        this.drawTerrain();

        // Dense Seattle-like downtown fabric: subtle district tones reach the canvas edges.
        c.fillStyle='rgba(244,232,220,.52)';c.fillRect(0,0,w*.31,ph*.32);
        c.fillStyle='rgba(230,237,240,.50)';c.fillRect(w*.27,0,w*.37,ph*.42);
        c.fillStyle='rgba(239,232,216,.48)';c.fillRect(w*.61,0,w*.39,ph*.43);
        c.fillStyle='rgba(233,231,223,.48)';c.fillRect(0,ph*.40,w*.45,ph*.46);
        c.fillStyle='rgba(229,236,228,.50)';c.fillRect(w*.43,ph*.40,w*.57,ph*.46);
        c.fillStyle='rgba(223,231,220,.58)';c.fillRect(0,ph*.86,w,ph*.14);
        this.text('HIGH GROUND / RECEPTION',w*.5,ph*.885,w<500?6:9,'#789078','center',750);

        this.syncCivilians(state);
        this.drawParcels(state);
        for(const p of PARKS)this.drawPark(p);

        for(const [i,b] of state.blocks.entries())this.drawBlockBuildings(b,i,state);
        // Every visible street comes from the same graph used by route() and traffic.
        const edges=this.graphEdges(state);for(const edge of edges)this.drawRoad(edge);

        // Waterfront/pier language sits at the tsunami-facing north edge.
        for(const id of ['A1','B1','C1','D1']){const p=this.xy(id),xx=p.x+(seeded(id,99)-.5)*8;this.round(xx-6,2,12,Math.max(15,p.y-8),2,'#c5b59e','#a99c87');}

        // Private traffic is continuous and piles up around congestion incidents.
        this.drawTraffic(state);
        this.drawRoadDamage(state);
        this.drawVisualDisasters(state,now);

        // Tsunami advances from TOP to BOTTOM so visual flow matches the scenario logic (row 1 → row 4).
        const front=this.floodFrontY(state),wave=x=>front+Math.sin(x*.020+(this.reducedMotion?0:now*.0009))*7+Math.sin(x*.057)*3.2;
        c.beginPath();c.moveTo(0,0);c.lineTo(w,0);for(let x=w;x>=-6;x-=7)c.lineTo(x,wave(x));c.closePath();
        const sea=c.createLinearGradient(0,0,0,Math.max(1,front));sea.addColorStop(0,'#4f9fc0ef');sea.addColorStop(.55,'#79b8cfe8');sea.addColorStop(1,'#b3d7e1d5');c.fillStyle=sea;c.fill();
        c.beginPath();for(let x=0;x<=w+7;x+=7){x?c.lineTo(x,wave(x)):c.moveTo(x,wave(x));}c.lineWidth=8;c.strokeStyle='#d9f1f0c2';c.stroke();c.lineWidth=1.5;c.strokeStyle='#ffffffdd';c.stroke();
        this.text('ELLIOTT BAY / TSUNAMI FRONT',w*.50,Math.max(17,front*.40),w<500?7:10,'#eaf9fb','center',800);

        for(const id of launchSites){const p=this.xy(id);this.round(p.x-16,p.y-19,32,7,3,'#e2d6c0','#b3a48d');this.text('LAUNCH',p.x,p.y-23,w<500?5:6,'#526f77','center',750);}

        for(const l of LANDMARKS)this.landmark(l);
        this.text('SEATTLE CENTER',w*.52,ph*.18,w<500?6:9,'#7f8584','center',800);
        this.text('BELLTOWN',w*.31,ph*.23,w<500?7:10,'#8d9290','center',750);
        this.text('DOWNTOWN',w*.51,ph*.45,w<500?7:10,'#8d9290','center',750);
        this.text('PIONEER SQUARE',w*.41,ph*.68,w<500?6:9,'#8d9290','center',750);
        this.text('SODO',w*.67,ph*.82,w<500?7:10,'#8d9290','center',750);
        const roadLabels=[['Alaskan Way',.08,.52,Math.PI/2],['1st Ave',.19,.52,Math.PI/2],['4th Ave',.43,.52,Math.PI/2],['5th Ave',.65,.52,Math.PI/2],['Denny Way',.49,.18,-.05],['Pine St',.49,.38,.03],['Madison St',.50,.59,-.035],['Yesler Way',.51,.79,.05]];
        for(const [name,x,y,a] of roadLabels)this.textRotated(name,w*x,ph*y,a,w<500?5:7,'#7e8484',600);
        for(const b of state.blocks){const p=this.xy(b.id);this.text(b.id,p.x-10,p.y-15,w<500?5:7,'#989d9a','center',800);this.text(b.name.toLowerCase().replace(/\b\w/g,s=>s.toUpperCase()),p.x,p.y+ph*.050,w<500?5:7,'#737a77','center',600);}

        // Persistent population stream: new people keep emerging from buildings, while existing dots remain on streets.
        this.drawCivilians(state,now);
        this.drawConvoys(state);
        this.drawReportedCrowds(state,now);
        this.drawCasualties(state);
        this.drawAmbulances(state);

        // Reception hubs: one west, one south-central, one east, so evacuation has multiple safe destinations.
        for(const s of state.shelters){
            const p=this.xy(s.id),rw=Math.min(104,w*.17),usedRatio=Math.min(1,s.used/s.capacity),reservedRatio=Math.min(1-usedRatio,s.reserved/s.capacity);
            this.round(p.x-rw/2,p.y-20,rw,42,9,'#edf5e8',state.selectedShelter===s.id?'#658f62':'#bed0b7');
            this.text(s.name,p.x,p.y-7,w<500?7:9,'#4f7350','center',700);
            // Main number means physically received residents only. It now increments
            // at the exact engine tick when a convoy/rescue vehicle reaches the hub.
            this.text(`${s.used}/${s.capacity} safe`,p.x,p.y+5,w<500?6:7,'#607768','center',700);
            if(s.reserved)this.text(`+${s.reserved} inbound`,p.x,p.y+14,w<500?5:6,'#8b8768','center',600);
            c.fillStyle='#d0dccb';c.fillRect(p.x-rw*.36,p.y+17,rw*.72,2.5);
            c.fillStyle=availableCapacity(s)<16?'#c57563':'#739d70';c.fillRect(p.x-rw*.36,p.y+17,rw*.72*usedRatio,2.5);
            if(s.reserved){c.fillStyle='#b9bd8a';c.fillRect(p.x-rw*.36+rw*.72*usedRatio,p.y+17,rw*.72*reservedRatio,2.5);}
            this.hits.push({kind:'shelter',id:s.id,x:p.x-rw/2,y:p.y-25,w:rw,h:50});
        }

        const allUnits=[...state.units,...state.drones];
        for(const u of allUnits){if(!u.trip)continue;const path=u.trip.path,isWater=u.kind==='skiff'&&u.trip.mode==='water';this.line(path,u.kind==='drone'?'#6f6f9686':u.kind==='air'?'#9a7b4586':isWater?'#2d829aa8':'#3c765594',isWater?3:2.5,[5,5]);}
        const selected=state.events.find(e=>e.id===state.selected);if(state.settings.routes){const from=selected?assessment(state,selected).block:state.selectedBlock;const suggestion=route(state,from,state.selectedShelter);if(suggestion){this.line(suggestion,'#ffffffdf',7);this.line(suggestion,'#2e9762',3.4,[4,5]);}}

        const markers=state.events.filter(e=>state.time>=e.at+5&&e.status!=='pending'&&(isOpen(e)||e.status==='assigned'||e.status==='transport')),offset={};
        for(const e of markers){if(!state.settings.aggregate&&!e.verified&&e.id!==state.selected&&!e.correction)continue;const a=assessment(state,e),p=this.xy(a.block),n=offset[a.block]||0;offset[a.block]=n+1;const x=p.x+n*22,y=p.y-7,color=e.verified?'#5f9968':a.severity==='high'?'#ca6658':'#9f9f60';c.fillStyle='#37493628';c.beginPath();c.ellipse(x+2,y+12,10,3,0,0,TAU);c.fill();c.beginPath();c.moveTo(x,y+13);c.lineTo(x-6,y+4);c.arc(x,y-4,12,Math.PI*.82,Math.PI*2.18);c.lineTo(x,y+13);c.fillStyle=color;c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();this.text(e.scan?'+':a.people,x,y,w<500?8:10,'#fff','center',700);if(e.id===state.selected){c.beginPath();c.arc(x,y-3,18,0,TAU);c.strokeStyle='#376d545e';c.setLineDash([2,4]);c.lineWidth=1;c.stroke();c.setLineDash([]);}this.hits.push({kind:'event',id:e.id,x:x-22,y:y-22,w:44,h:44});}
        for(const incident of state.roadIncidents.filter(r=>r.status!=='pending'&&r.status!=='cleared')){const p=this.pathPoint(...incident.edge,.5);this.round(p.x-17,p.y-12,34,24,7,incident.status==='working'?'#9cbd85':'#d66b58','#fff');this.text(incident.kind==='collision'?'!':incident.kind==='collapse'?'×':'≡',p.x,p.y+5,17,'#fff','center',800);this.hits.push({kind:'road',id:incident.id,x:p.x-24,y:p.y-24,w:48,h:48});}
        // Draw mission units from engine trip state. Ready ground teams remain visible
        // at their current hub/sector so a dispatch has an obvious start and movement.
        const readyOffsets=new Map();
        for(const u of allUnits){
            let p;
            if(u.trip){const t=u.trip;p=this.along(t.path,Math.min(1,(state.time-t.started)/(t.ends-t.started)));}
            else if(u.kind==='ground'){
                const n=readyOffsets.get(u.position)||0;readyOffsets.set(u.position,n+1);
                const base=this.xy(u.position);p={x:base.x-12+n*24,y:base.y-29};
            } else continue;
            this.drawUnit(u,p,now);
        }
        if(this.dropHover){const p=this.xy(this.dropHover.kind==='road'?state.roadIncidents.find(r=>r.id===this.dropHover.id).edge[0]:this.dropHover.kind==='event'?assessment(state,state.events.find(e=>e.id===this.dropHover.id)).block:this.dropHover.id);c.beginPath();c.arc(p.x,p.y,25,0,TAU);c.fillStyle='#eaf5e654';c.fill();c.strokeStyle='#4f8f5d';c.lineWidth=2;c.setLineDash([4,4]);c.stroke();c.setLineDash([]);}
    }

    drawUnit(u,p,now){
        const c=this.ctx;c.save();c.translate(p.x,p.y);c.fillStyle='#33432f20';c.beginPath();c.ellipse(3,7,11,4,0,0,TAU);c.fill();
        if(u.kind==='ground'){this.round(-9,-5,17,10,3,'#f4f0d8','#4c714b');c.fillStyle='#5e8a58';c.fillRect(-5,-4,5,8);c.fillStyle='#424e3e';c.fillRect(-6,-7,4,2);c.fillRect(4,-7,4,2);c.fillRect(-6,5,4,2);c.fillRect(4,5,4,2);}
        else if(u.kind==='skiff'&&u.trip?.mode==='trailer'){this.round(-13,-5,9,9,2,'#657b61','#425542');c.fillStyle='#354437';c.beginPath();c.arc(-11,6,2,0,TAU);c.arc(-5,6,2,0,TAU);c.fill();c.strokeStyle='#60786a';c.lineWidth=1.5;c.beginPath();c.moveTo(-4,1);c.lineTo(0,1);c.stroke();this.round(0,-4,13,8,3,'#f5f2da','#4b8391');c.fillStyle='#354437';c.beginPath();c.arc(3,5,2,0,TAU);c.arc(10,5,2,0,TAU);c.fill();}
        else if(u.kind==='skiff'){c.beginPath();c.moveTo(-9,-5);c.lineTo(6,-5);c.lineTo(12,0);c.lineTo(6,5);c.lineTo(-9,5);c.closePath();c.fillStyle='#f5f2da';c.fill();c.strokeStyle='#47899b';c.lineWidth=2;c.stroke();c.fillStyle='#75a5ad';c.fillRect(-4,-3,7,6);}
        else if(u.kind==='air'){this.round(-8,-4,16,9,4,'#f3e6b9','#9b7e45');c.strokeStyle='#746b4e';c.lineWidth=2;c.beginPath();c.moveTo(-14,0);c.lineTo(10,0);c.moveTo(0,-11);c.lineTo(0,11);c.stroke();}
        else{c.strokeStyle='#6e6f8f';c.lineWidth=2;c.beginPath();c.moveTo(-6,-6);c.lineTo(6,6);c.moveTo(6,-6);c.lineTo(-6,6);c.stroke();for(const[x,y]of[[-6,-6],[6,-6],[-6,6],[6,6]]){c.beginPath();c.arc(x,y,4,0,TAU);c.stroke();}this.round(-3,-3,6,6,2,'#eeedf2');if(u.status==='scanning'&&u.trip.ends<=this.lastTime){c.beginPath();c.arc(0,0,18+Math.sin(now*.003)*4,0,TAU);c.strokeStyle='#8888a74d';c.stroke();}}
        if(u.cargo){const dots=Math.min(4,u.cargo);for(let i=0;i<dots;i++){c.fillStyle='#334d55';c.beginPath();c.arc(-4+i*2.8,-1+(i%2)*2,1.1,0,TAU);c.fill();}}
        c.restore();
    }
    along(path,progress){if(!path?.length)return{x:0,y:0};if(path.length===1)return this.xy(path[0]);const t=Math.max(0,Math.min(.999999,progress))*(path.length-1),i=Math.floor(t);return this.pathPoint(path[i],path[Math.min(i+1,path.length-1)],t-i);}
}