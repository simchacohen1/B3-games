'use strict';
// Firebase email-link sign-in has a "password" sign_in_provider in ID tokens.
// Do not accept anonymous, unverified, or arbitrary other providers.
function verifiedTeacherIdentity(identity){
 return !!(identity&&typeof identity.uid==='string'&&identity.uid.length>0&&
  typeof identity.email==='string'&&identity.email.includes('@')&&
  identity.email_verified===true&&
  ['google.com','password'].includes(identity.firebase?.sign_in_provider));
}
module.exports={verifiedTeacherIdentity};
