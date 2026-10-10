// Interactive behavior + Supabase form integration. All page content remains in HTML.
const cfg=window.TPG_CONFIG||{};
const configured=cfg.supabaseUrl&&!cfg.supabaseUrl.includes('YOUR_PROJECT_REF')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.includes('YOUR_SUPABASE');
const headers=()=>({'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'Authorization':`Bearer ${cfg.supabaseAnonKey}`});
const rpc=async(name,body)=>{if(!configured)throw new Error('Website database is not configured yet.');const r=await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)});if(!r.ok)throw new Error((await r.text())||'Submission failed');return r.json()};

const menu=document.querySelector('.menu');if(menu)menu.addEventListener('click',()=>{const links=document.querySelector('#navlinks');const opened=links.classList.toggle('open');menu.setAttribute('aria-expanded',String(opened));menu.textContent=opened?'×':'☰'});

const reason=document.querySelector('#reason');
if(reason){
  const param=new URLSearchParams(location.search).get('reason');if(param&&[...reason.options].some(o=>o.value===param))reason.value=param;
  const programFields=document.querySelector('#program-fields');const update=()=>programFields.hidden=reason.value!=='workshop';reason.addEventListener('change',update);update();
  document.querySelector('#contact-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,status=document.querySelector('#contact-status'),button=form.querySelector('button[type=submit]');const d=new FormData(form);
    status.textContent='Sending…';button.disabled=true;
    try{
      await rpc('submit_contact_inquiry',{
        p_first_name:d.get('first'),p_last_name:d.get('last'),p_email:d.get('email'),p_phone:d.get('phone')||'',p_city_state:d.get('city')||'',p_organization:d.get('organization')||'',p_reason:d.get('reason'),p_message:d.get('message'),p_referral_source:d.get('source')||'',p_marketing_opt_in:d.has('updates'),
        p_preferred_date:d.get('date')||null,p_alternate_date:d.get('alternate')||null,p_estimated_attendance:d.get('attendance')?Number(d.get('attendance')):null,p_audience_age_group:d.get('audience')||null,p_delivery_preference:d.get('format')||null,p_organization_type:d.get('orgtype')||null,p_accessibility_needs:d.get('access')||null
      });
      status.textContent=reason.value==='workshop'?'Thank you. Your Give Life program request has been received.':'Thank you. Your message has been received.';form.reset();update();
    }catch(err){status.textContent=err.message||'We could not submit your request. Please try again.'}finally{button.disabled=false}
  });
}

document.querySelectorAll('#newsletter-form').forEach(form=>form.addEventListener('submit',async e=>{
  e.preventDefault();const status=form.querySelector('.status'),button=form.querySelector('button[type=submit]');const email=form.querySelector('input[type=email]').value,zip=form.querySelector('input[placeholder="ZIP code"]').value;
  status.textContent='Joining…';button.disabled=true;
  try{await rpc('subscribe_email',{p_email:email,p_zip_code:zip});status.textContent='Thank you for joining the Give Life community.';form.reset()}catch(err){status.textContent=err.message||'Signup failed. Please try again.'}finally{button.disabled=false}
}));

const resourceForm=document.querySelector('#resource-download-form');
if(resourceForm)resourceForm.addEventListener('submit',async e=>{
  e.preventDefault();const status=document.querySelector('#resource-status'),button=resourceForm.querySelector('button[type=submit]'),d=new FormData(resourceForm);
  status.textContent='Preparing your tracker…';button.disabled=true;
  try{
    if(!configured)throw new Error('Website database is not configured yet.');
    const r=await fetch(`${cfg.supabaseUrl}/functions/v1/resource-signup`,{method:'POST',headers:headers(),body:JSON.stringify({firstName:d.get('first_name'),email:d.get('email'),zipCode:d.get('zip_code'),marketingOptIn:d.has('marketing_opt_in'),resourceSlug:'kidney-health-tracker'})});
    const out=await r.json();if(!r.ok||!out.ok)throw new Error(out.error||'Could not prepare download.');
    status.innerHTML=`Your Kidney Health Tracker is ready. <a href="${out.downloadUrl}" target="_blank" rel="noopener">Download your tracker →</a>`;
  }catch(err){status.textContent=err.message||'Could not prepare your download. Please try again.'}finally{button.disabled=false}
});
