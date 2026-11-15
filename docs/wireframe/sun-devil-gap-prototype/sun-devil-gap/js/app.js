// Front-end demonstration only: routing and event availability are not yet connected.
const $ = id => document.getElementById(id);
const samplePlaces = [
  {name:'Campus coffee stop',type:'Coffee',icon:'☕',duration:15},
  {name:'Quiet study space',type:'Study',icon:'📚',duration:30},
  {name:'Quick lunch option',type:'Food',icon:'🍴',duration:30},
  {name:'Campus event listing',type:'Events',icon:'✨',duration:45}
];
function showView(view){const explore=view==='explore';$('plan-view').hidden=explore;$('explore-view').hidden=!explore;$('tab-plan').classList.toggle('active',!explore);$('tab-explore').classList.toggle('active',explore);}
$('tab-plan').addEventListener('click',()=>showView('plan'));
$('tab-explore').addEventListener('click',()=>showView('explore'));
$('gap').addEventListener('input',()=>{$('gap-label').textContent=$('gap').value+' min';});
$('plan-button').addEventListener('click',()=>{if(!$('origin').value||!$('destination').value||!$('day').value||!$('class-time').value){$('validation').textContent='Please complete all schedule fields before continuing.';return;}$('validation').textContent='';$('future-date').value=$('day').value;showView('explore');renderPlaces();});
function renderPlaces(){const categories=[...document.querySelectorAll('.chips input:checked')].map(input=>input.value);const min=Number($('min-visit').value);const places=samplePlaces.filter(place=>categories.includes(place.type)&&place.duration>=min);$('results').replaceChildren();for(const place of places){const item=document.createElement('div');item.className='result';const icon=document.createElement('span');icon.className='result-icon';icon.textContent=place.icon;const body=document.createElement('div');const title=document.createElement('strong');title.textContent=place.name;const sub=document.createElement('small');sub.textContent=place.type+' · Sample · '+place.duration+' min suggested visit';body.append(title,sub);item.append(icon,body);$('results').append(item);}$('results-count').textContent=places.length+' places';$('result-summary').textContent='Illustrative results · not checked for reachability';}
$('apply-button').addEventListener('click',renderPlaces);
document.querySelectorAll('.chips input').forEach(input=>input.addEventListener('change',renderPlaces));
$('min-visit').addEventListener('change',renderPlaces);
$('day').value=new Date().toLocaleDateString('en-CA');
$('future-date').value=$('day').value;
renderPlaces();
