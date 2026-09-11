// A classic script can explain file:// restrictions before module loading fails.
const startupStatus=document.querySelector('#status');
const startupDetail=document.querySelector('#substatus');
function startupError(title,detail){
  startupStatus.textContent=title;
  startupDetail.textContent=detail;
  document.querySelector('#loading').className='error';
  document.querySelector('#retry').hidden=true;
}

if(location.protocol==='file:'){
  startupError('Start a local server to load the city',
    'From the project folder, run npm ci, then npm run dev. Open the localhost URL printed in the terminal. Opening index.html directly cannot load the game.');
}else{
  import('./app.js').catch(error=>{
    console.error('The 3D viewer could not start:',error);
    // Keep the renderer's specific WebGL guidance if it already reported failure.
    if(startupStatus.textContent==='WebGL is unavailable')return;
    startupError('The 3D viewer could not start',error.message+' Reload the page to try again.');
  });
}
