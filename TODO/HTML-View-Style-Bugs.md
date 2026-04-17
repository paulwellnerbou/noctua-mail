# Fixing HTML view issues

## Dark mode style problems

### Linked Mails

Titles of Linkedin mails are rendered in light color on white in dark mode:

![Example showing light title on white background in linkedin mail](linkedin-white-title.png)

This may be a problem of the mails itself, as it forces a white background and does not force dark color for the titles. But I am not sure. Please investigate.

There are similar problems with mails that don't have a background set but contain black text.

If it is a problem of the mails itself, can you recommend a way to fix styles in mails like this?

Message source of the LinkedIn mail:

```
Return-Path: <m-13asjv18ibnghqhq3tcskefmduxyp5rjqzt6pwaw4wrytvjh5qh8yhwmr8@bounce.linkedin.com>
Authentication-Results:  kundenserver.de; dkim=pass header.i=@mailb.linkedin.com
Authentication-Results:  kundenserver.de; dkim=pass header.i=@linkedin.com
Received: from mailb-ga.linkedin.com ([108.174.0.145]) by mx.kundenserver.de
 (mxeue002 [212.227.15.41]) with ESMTPS (Nemesis) id 1MLjw8-1vRLnW2vlA-00HuBd
 for <paul@wellnerbou.de>; Thu, 22 Jan 2026 12:14:51 +0100
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mailb.linkedin.com;
	s=d2048-202308-0b; t=1769080486;
	bh=UQBAxef1Yl9ukCXwWmFJRMu9MnSwWj1Xoy0pJ/fHOtM=;
	h=Date:From:Subject:MIME-Version:Content-Type:To:X-LinkedIn-Class:
	 X-LinkedIn-Template:X-LinkedIn-fbl;
	b=TlAZDfg0OlEJAuXfc3ZbMUMFxCcQh90zqo54M8o6OT6v99LYr9sFyfKWTlTKUIcnB
	 7Xlm6WzFBAZUV95GSb9x9nqiTI5Usnqj8ZgQLfQ66SGLJwEeBzPDyZonZU/yXjJvSA
	 CTk+q1fM5zmoSXfnza8S83tCDxebWIj7v9I5P6OIqQXb56vCUGFR1mI2PBFdMhPo5N
	 cNcOFTvRXWkB7hUCDb0UPCXGsrgMrMsH6vuQjadFRD+hOMoKPMylwiV8feQbAvHihk
	 vGtSRVhexju52YrAKSjHUeOvmhjQctog5Mk8r5Ku5SHptb6lNZYmhlWCWhYT2XGN/l
	 XoGlmnrUmrpUw==
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=linkedin.com;
	s=d2048-202308-00; t=1769080486;
	bh=UQBAxef1Yl9ukCXwWmFJRMu9MnSwWj1Xoy0pJ/fHOtM=;
	h=Date:From:Subject:MIME-Version:Content-Type:To:X-LinkedIn-Class:
	 X-LinkedIn-Template:X-LinkedIn-fbl;
	b=AVRKkzRwfswmRTeX9sb+HOzGsXQrqYWf3iCF6iC3pH4OqF75JVteRaS3viF+S2uZJ
	 7q2YpLhgYcNf8y0+0/N25a/mxvAbUieW9Eg7Sp7eZpb4+uy6/hou9DjwTN+gk5wBcX
	 YLdpYaXLoiwK8El9UiqTcpgkmMCTgxBYyEu76DOu0MOeW+Mw86NoFb65XBbojxcM3T
	 69cmcX51AtmjeA4yRqoj5YtdDpWubOsStLQroQDVJF8bqMpSoolargWiBxYFCKUWjU
	 MINfBeOhxW+YSJ33/YGgqRpTcMmau+0j9DqtuX5LfKfmTvUdIBRaeTjKUsr73dRfCa
	 /FHcV1bQxnIfQ==
Date: Thu, 22 Jan 2026 11:14:46 +0000 (UTC)
From: Shira Fahrenberg <inmail-hit-reply@linkedin.com>
Message-ID: <2131471304.31643466.1769080486181@ltx1-app103679.prod.linkedin.com>
Subject: Vertrauliche Direktvermittlung: (Senior) Sophora-Entwickler(Java) -
 100% Remote
MIME-Version: 1.0
Content-Type: multipart/alternative; 
	boundary="----=_Part_31643460_1988832987.1769080486173"
To: Paul Wellner Bou <paul@wellnerbou.de>
X-LinkedIn-Class: INMAIL
X-LinkedIn-Template: email_hire_inmail_initial_single_01
X-LinkedIn-fbl: m2-aszpfazzrr2ed52b0z68xl263kdxqiqh1vhi48hur4mucuigl8ziicc01dfjna4oe41nbacd4anj0xcu1ln6a202ospwf9otptr33g
X-LinkedIn-Id: ckbds4-mkpcueqa-t4
List-Unsubscribe: <https://www.linkedin.com/comm/psettings/email-unsubscribe?lipi=urn%3Ali%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&midToken=AQFM61JoD1kdcA&midSig=19LGmoAfG2VI41&trk=eml-email_hire_inmail_initial_single_01-unsub-0-unsub&trkEmail=eml-email_hire_inmail_initial_single_01-unsub-0-unsub-null-ckbds4~mkpcueqa~t4-null-null&eid=ckbds4-mkpcueqa-t4&loid=AQGszkRNExwd1QAAAZvlafblMjtWo52qrQvgR0d1o3aWGw8NBZgDjN0xs1aYdijSqvzRsiKz8upzaoOpdlMxNEzOiMx3bbc>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
Reply-To: 
	Shira Fahrenberg <c15c178d-5301-4d85-81dc-bfcca1ed21ad@reply.linkedin.com>
Require-Recipient-Valid-Since: paul@wellnerbou.de; Wed, 28 Aug 2019 07:12:31 +0000
Envelope-To: <paul@wellnerbou.de>
UI-InboundReport: unknown:2;M01:P0:VDI+7HPJ23g=;hOsgHw5j5eylla0c7GzgPS1gZxm2
 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

------=_Part_31643460_1988832987.1769080486173
Content-Type: text/plain;charset=UTF-8
Content-Transfer-Encoding: quoted-printable
Content-ID: text-body

Vertrauliche Direktvermittlung: (Senior) Sophora-Entwickler(Java) - 100% Re=
mote
Vertrauliche Direktvermittlung: (Senior) Sophora-Entwickler(Java) - 100% Re=
mote

      Shira Fahrenberg
        Reply
        https://www.linkedin.com/messaging/thread/2-N2M3MmEwNDMtZDU4YS00NWE=
yLTkyOWMtNzI2MzAxYzZjNGY1XzEwMA=3D=3D/

Hallo Paul,

ich hoffe, du bist gut ins neue Jahr gestartet und dir geht es gut!

Ich bin auf dein Profil gesto=C3=9Fen, da ich im Rahmen einer vertraulichen=
 Suche aktuell eine 100%-Remote-Position f=C3=BCr eine:n Sophora-Entwickler=
:in (Java) betreue.=20

Bist du auch offen f=C3=BCr eine Festanstellung?=20

Kurz zu den Rahmenbedingungen:

 =E2=80=A2 100 % Remote (DE)
 =E2=80=A2 freie Hardwarewahl
 =E2=80=A2 spannende Digital- & Medienprojekte (u. a. =C3=B6ffentlicher Ber=
eich)
 =E2=80=A2 modernes Tech-Setup mit Fokus auf Qualit=C3=A4t & saubere Prozes=
se

=F0=9F=9B=A0 Tech-Stack (Kernanforderungen):

 =E2=80=A2 Java (Senior-Level)
 =E2=80=A2 Sophora CMS
 =E2=80=A2 Spring, Maven, Git
 =E2=80=A2 APIs (GraphQL / REST)
 =E2=80=A2 Docker / Kubernetes=20

Falls du derzeit grunds=C3=A4tzlich offen f=C3=BCr einen Wechsel bist, freu=
e ich mich =C3=BCber, wenn wir einmal miteinander telefonieren: https://cal=
endar.app.google/BBy3H8wgRbYY7VR2A

Ich freue mich auf deine R=C3=BCckmeldung - auch dann, wenn es derzeit nich=
t spannend ist, w=C3=BCsste ich ein kurzes Feedback sehr zu sch=C3=A4tzen!

Viele Gr=C3=BC=C3=9Fe
Shira

=F0=9F=93=A7 shira@tech-recruiting.de
=F0=9F=93=9E +49 159 01375281
=F0=9F=8C=90 fahrenbergrecruitingsolutions.com

Shira Fahrenberg | Founder Senior Tech Recruiter

   =20

----------------------------------------

This email was intended for Paul Wellner Bou (Software Architect, Full-Stac=
k Developer, Tech-Lead)
Learn why we included this: https://www.linkedin.com/help/linkedin/answer/4=
788?lang=3Den&lipi=3Durn%3Ali%3Apage%3Aemail_email_hire_inmail_initial_sing=
le_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&midToken=3DAQFM61JoD1kdcA&midSig=3D19L=
GmoAfG2VI41&trk=3Deml-email_hire_inmail_initial_single_01-SecurityHelp-0-te=
xtfooterglimmer&trkEmail=3Deml-email_hire_inmail_initial_single_01-Security=
Help-0-textfooterglimmer-null-ckbds4~mkpcueqa~t4-null-null&eid=3Dckbds4-mkp=
cueqa-t4
You are receiving LinkedIn notification emails.

Unsubscribe: https://www.linkedin.com/comm/psettings/email-unsubscribe?lipi=
=3Durn%3Ali%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQI=
ipGy2H9SdmjA%3D%3D&midToken=3DAQFM61JoD1kdcA&midSig=3D19LGmoAfG2VI41&trk=3D=
eml-email_hire_inmail_initial_single_01-unsubscribe-0-textfooterglimmer&trk=
Email=3Deml-email_hire_inmail_initial_single_01-unsubscribe-0-textfootergli=
mmer-null-ckbds4~mkpcueqa~t4-null-null&eid=3Dckbds4-mkpcueqa-t4&loid=3DAQGs=
zkRNExwd1QAAAZvlafblMjtWo52qrQvgR0d1o3aWGw8NBZgDjN0xs1aYdijSqvzRsiKz8upzaoO=
pdlMxNEzOiMx3bbc
Help: https://www.linkedin.com/help/linkedin/answer/67?lang=3Den&lipi=3Durn=
%3Ali%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H=
9SdmjA%3D%3D&midToken=3DAQFM61JoD1kdcA&midSig=3D19LGmoAfG2VI41&trk=3Deml-em=
ail_hire_inmail_initial_single_01-help-0-textfooterglimmer&trkEmail=3Deml-e=
mail_hire_inmail_initial_single_01-help-0-textfooterglimmer-null-ckbds4~mkp=
cueqa~t4-null-null&eid=3Dckbds4-mkpcueqa-t4

=C2=A9 2026 LinkedIn Corporation, 1zwnj000 West Maude Avenue, Sunnyvale, CA=
 94085.
LinkedIn and the LinkedIn logo are registered trademarks of LinkedIn.
------=_Part_31643460_1988832987.1769080486173
Content-Type: text/html;charset=UTF-8
Content-Transfer-Encoding: quoted-printable
Content-ID: html-body

<html xmlns=3D"http://www.w3.org/1999/xhtml" lang=3D"en" xml:lang=3D"en"> <=
head> <meta http-equiv=3D"Content-Type" content=3D"text/html;charset=3Dutf-=
8"> <meta name=3D"HandheldFriendly" content=3D"true"> <meta name=3D"viewpor=
t" content=3D"width=3Ddevice-width; initial-scale=3D0.666667; user-scalable=
=3D0"> <meta name=3D"viewport" content=3D"width=3Ddevice-width"> <title></t=
itle> <style>
              @media (max-width: 512px) { .mercado-container { width: 100% =
!important; } }
            </style> <style>
            @media (max-width: 480px) { .inline-button, .inline-button tabl=
e { display: none !important; }
            .full-width-button, .full-width-button table { display: table !=
important; } }
          </style> <style>body {font-family: -apple-system, system-ui, Blin=
kMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
            'Fira Sans', Ubuntu, Oxygen, 'Oxygen Sans', Cantarell, 'Droid S=
ans', 'Apple Color Emoji', 'Segoe UI Emoji',
            'Segoe UI Emoji', 'Segoe UI Symbol', 'Lucida Grande', Helvetica=
, Arial, sans-serif;}</style> <!--[if mso]><style type=3D"text/css"> </styl=
e><![endif]--> <!--[if IE]><style type=3D"text/css"> </style><![endif]--> <=
/head> <body dir=3D"ltr" class=3D"font-sans bg-color-background-canvas w-fu=
ll m-0 p-0 pt-1" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adj=
ust: 100%; margin: 0px; width: 100%; background-color: #f3f2f0; padding: 0p=
x; padding-top: 8px; font-family: -apple-system, system-ui, BlinkMacSystemF=
ont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Fira Sans', Ubuntu, Oxygen, 'Ox=
ygen Sans', Cantarell, 'Droid Sans', 'Apple Color Emoji', 'Segoe UI Emoji',=
 'Segoe UI Emoji', 'Segoe UI Symbol', 'Lucida Grande', Helvetica, Arial, sa=
ns-serif;"> <div class=3D"h-0 opacity-0 text-transparent invisible overflow=
-hidden w-0 max-h-[0]" style=3D"visibility: hidden; height: 0px; max-height=
: 0; width: 0px; overflow: hidden; opacity: 0; mso-hide: all;" data-email-p=
reheader=3D"true">Hallo Paul,ich hoffe, du bist gut ins neue Jahr ge...</di=
v> <div class=3D"h-0 opacity-0 text-transparent invisible overflow-hidden w=
-0 max-h-[0]" style=3D"visibility: hidden; height: 0px; max-height: 0; widt=
h: 0px; overflow: hidden; opacity: 0; mso-hide: all;"> =CD=8F=C2=A0=CD=8F=
=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=
=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=
=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=
=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=
=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=
=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=
=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=
=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=
=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=
=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=
=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=
=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0 =CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=
=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0=CD=8F=C2=A0 </=
div> <table role=3D"presentation" valign=3D"top" border=3D"0" cellspacing=
=3D"0" cellpadding=3D"0" width=3D"512" align=3D"center" class=3D"mercado-co=
ntainer w-[512px] max-w-[512px] mx-auto my-0 p-0 " style=3D"-webkit-text-si=
ze-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-tab=
le-rspace: 0pt; margin-left: auto; margin-right: auto; margin-top: 0px; mar=
gin-bottom: 0px; width: 512px; max-width: 512px; padding: 0px;"> <tbody> <t=
r> <td style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;=
 mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <table role=3D"presentatio=
n" valign=3D"top" border=3D"0" cellspacing=3D"0" cellpadding=3D"0" width=3D=
"100%" class=3D"bg-color-background-container " style=3D"-webkit-text-size-=
adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-=
rspace: 0pt; background-color: #ffffff;"> <tbody> <tr> <td class=3D"text-ce=
nter p-3" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 10=
0%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; padding: 24px; text-align=
: center;"> <table role=3D"presentation" valign=3D"top" border=3D"0" cellsp=
acing=3D"0" cellpadding=3D"0" width=3D"100%" class=3D"min-w-full" style=3D"=
-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspac=
e: 0pt; mso-table-rspace: 0pt; min-width: 100%;"> <tbody> <tr> <td align=3D=
"left" valign=3D"middle" style=3D"-webkit-text-size-adjust: 100%; -ms-text-=
size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <a href=
=3D"https://www.linkedin.com/comm/feed/?lipi=3Durn%3Ali%3Apage%3Aemail_emai=
l_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midToken=
=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-email_hire_inma=
il_initial_single_01-header-0-home_glimmer&amp;trkEmail=3Deml-email_hire_in=
mail_initial_single_01-header-0-home_glimmer-null-ckbds4~mkpcueqa~t4-null-n=
ull&amp;eid=3Dckbds4-mkpcueqa-t4" target=3D"_blank" class=3D"w-[84px]" styl=
e=3D"color: #0a66c2; cursor: pointer; display: inline-block; text-decoratio=
n: none; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; width:=
 84px;"> <img alt=3D"LinkedIn" src=3D"https://static.licdn.com/aero-v1/sc/h=
/9ehe6n39fa07dc5edzv0rla4e" class=3D"h-[21px] w-[84px]" style=3D"outline: n=
one; text-decoration: none; -ms-interpolation-mode: bicubic; height: 21px; =
width: 84px;" width=3D"84" height=3D"21"> </a> </td> <td valign=3D"middle" =
align=3D"right" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adju=
st: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <table role=3D"pr=
esentation" valign=3D"top" border=3D"0" cellspacing=3D"0" cellpadding=3D"0"=
 width=3D"100%" data-test-header-profile style=3D"-webkit-text-size-adjust:=
 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace:=
 0pt;"> <tbody> <tr> <td align=3D"right" valign=3D"middle" class=3D"w-[32px=
]" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso=
-table-lspace: 0pt; mso-table-rspace: 0pt; width: 32px;" width=3D"32"> <a h=
ref=3D"https://de.linkedin.com/comm/in/paul-wellner-bou-404517192?lipi=3Dur=
n%3Ali%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2=
H9SdmjA%3D%3D&amp;midToken=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp=
;trk=3Deml-email_hire_inmail_initial_single_01-header-0-profile_glimmer&amp=
;trkEmail=3Deml-email_hire_inmail_initial_single_01-header-0-profile_glimme=
r-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dckbds4-mkpcueqa-t4" target=3D=
"_blank" style=3D"color: #0a66c2; cursor: pointer; display: inline-block; t=
ext-decoration: none; -webkit-text-size-adjust: 100%; -ms-text-size-adjust:=
 100%;"> <img alt=3D"Paul Wellner Bou" src=3D"https://media.licdn.com/dms/i=
mage/v2/C4D03AQGmLL2Q2tPXcA/profile-displayphoto-shrink_200_200/profile-dis=
playphoto-shrink_200_200/0/1567668864456?e=3D2147483647&amp;v=3Dbeta&amp;t=
=3DwmWkkwiNRsAtMRyfc9mbhd1M-Hvu9BucmgP_FjLxlC0" class=3D"rounded-[100%] w-[=
32px] h-[32px]" style=3D"outline: none; text-decoration: none; -ms-interpol=
ation-mode: bicubic; height: 32px; width: 32px; border-radius: 100%;" width=
=3D"32" height=3D"32"> </a> </td> </tr> </tbody> </table> </td> </tr> </tbo=
dy> </table> </td> </tr> <tr> <td class=3D"px-3 pb-3" style=3D"-webkit-text=
-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-=
table-rspace: 0pt; padding-left: 24px; padding-right: 24px; padding-bottom:=
 24px;"> <div> <table role=3D"presentation" valign=3D"top" border=3D"0" cel=
lspacing=3D"0" cellpadding=3D"0" width=3D"100%" style=3D"-webkit-text-size-=
adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-=
rspace: 0pt;"> <tbody> <tr> <td style=3D"-webkit-text-size-adjust: 100%; -m=
s-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <=
h1 class=3D"text-xl font-bold" style=3D"margin: 0; font-size: 24px; font-we=
ight: 600;"> Vertrauliche Direktvermittlung: (Senior) Sophora-Entwickler(Ja=
va) - 100% Remote </h1> </td> </tr> <tr> <td class=3D"text-md text-cool-gra=
y-80 pt-1" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 1=
00%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; padding-top: 8px; font-s=
ize: 16px; color: #38434f;"> Learn about a new opportunity. </td> </tr> <tr=
> <td class=3D"pt-2" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size=
-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; padding-top: 1=
6px;"> <table role=3D"presentation" valign=3D"top" border=3D"0" cellspacing=
=3D"0" cellpadding=3D"0" width=3D"auto" style=3D"-webkit-text-size-adjust: =
100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: =
0pt;"> <tbody> <tr> <td class=3D"align-middle pr-1" width=3D"64" style=3D"-=
webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace=
: 0pt; mso-table-rspace: 0pt; padding-right: 8px; vertical-align: middle;">=
 <a href=3D"https://www.linkedin.com/comm/in/shira-fahrenberg?lipi=3Durn%3A=
li%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9Sd=
mjA%3D%3D&amp;midToken=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=
=3Deml-email_hire_inmail_initial_single_01-ProfileCard-0-profile_image&amp;=
trkEmail=3Deml-email_hire_inmail_initial_single_01-ProfileCard-0-profile_im=
age-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dckbds4-mkpcueqa-t4" target=
=3D"_blank" style=3D"color: #0a66c2; cursor: pointer; display: inline-block=
; text-decoration: none; -webkit-text-size-adjust: 100%; -ms-text-size-adju=
st: 100%;"> <img class=3D"inline-block relative bg-color-entity-ghost-backg=
round clip-path-circle-50 rounded-full w-8 h-8" src=3D"https://media.licdn.=
com/dms/image/v2/D4D03AQHhnw_OYpcD1g/profile-displayphoto-scale_200_200/B4D=
ZsMzm5XJ8AY-/0/1765446414584?e=3D2147483647&amp;v=3Dbeta&amp;t=3DHa_Y_vO4at=
2IS38-wgwBwhgKCQU1fg0bMnzaif3Zs0k" alt=3D"Shira Fahrenberg profile picture"=
 style=3D"outline: none; text-decoration: none; -ms-interpolation-mode: bic=
ubic; position: relative; display: inline-block; height: 64px; width: 64px;=
 border-radius: 9999px; background-color: #eae6df; clip-path: circle(50%);"=
 width=3D"64" height=3D"64"> </a> </td> <td class=3D"align-middle" style=3D=
"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspa=
ce: 0pt; mso-table-rspace: 0pt; vertical-align: middle;"> <table role=3D"pr=
esentation" valign=3D"top" border=3D"0" cellspacing=3D"0" cellpadding=3D"0"=
 width=3D"100%" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adju=
st: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <tbody> <tr> <td =
style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-ta=
ble-lspace: 0pt; mso-table-rspace: 0pt;"> <span class=3D"text-md font-bold"=
 style=3D"font-size: 16px; font-weight: 600;"> <a href=3D"https://www.linke=
din.com/comm/in/shira-fahrenberg?lipi=3Durn%3Ali%3Apage%3Aemail_email_hire_=
inmail_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midToken=3DAQFM=
61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-email_hire_inmail_init=
ial_single_01-ProfileCard-0-profile_name&amp;trkEmail=3Deml-email_hire_inma=
il_initial_single_01-ProfileCard-0-profile_name-null-ckbds4~mkpcueqa~t4-nul=
l-null&amp;eid=3Dckbds4-mkpcueqa-t4" target=3D"_blank" style=3D"color: #0a6=
6c2; cursor: pointer; display: inline-block; text-decoration: none; -webkit=
-text-size-adjust: 100%; -ms-text-size-adjust: 100%;"> Shira Fahrenberg </a=
> </span> </td> </tr> <tr> <td class=3D"text-sm font-regular pt-0.25" style=
=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-l=
space: 0pt; mso-table-rspace: 0pt; padding-top: 2px; font-size: 14px; font-=
weight: 400;"> Expert in IT &amp; Tech Recruiting | I help CIOs and IT lead=
ers fill critical key roles within 6=E2=80=9312 weeks =E2=80=93 data-driven=
, technically grounded, and with tangible relief for HR. </td> </tr> <tr> <=
td class=3D"text-xs font-regular text-cool-gray-70 pt-0.25" style=3D"-webki=
t-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt=
; mso-table-rspace: 0pt; padding-top: 2px; font-size: 12px; font-weight: 40=
0; color: #56687a;"> Minden, North Rhine-Westphalia, Germany </td> </tr> </=
tbody> </table> </td> </tr> </tbody> </table> </td> </tr> <tr> <td class=3D=
"message-contents pt-2 pb-2 text-md text-cool-gray-80" style=3D"-webkit-tex=
t-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso=
-table-rspace: 0pt; word-wrap: break-word; line-height: 1.5em; margin: 0; p=
adding-bottom: 16px; padding-top: 16px; font-size: 16px; color: #38434f;"> =
Hallo Paul, <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> ich hoffe, =
du bist gut ins neue Jahr gestartet und dir geht es gut! <br aria-hidden=3D=
"true"> <br aria-hidden=3D"true"> Ich bin auf dein Profil gesto=C3=9Fen, da=
 ich im Rahmen einer vertraulichen Suche aktuell eine 100%-Remote-Position =
f=C3=BCr eine:n Sophora-Entwickler:in (Java) betreue. <br aria-hidden=3D"tr=
ue"> <br aria-hidden=3D"true"> Bist du auch offen f=C3=BCr eine Festanstell=
ung? <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> Kurz zu den Rahmen=
bedingungen: <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> =E2=80=A2 =
100 % Remote (DE) <br aria-hidden=3D"true"> =E2=80=A2 freie Hardwarewahl <b=
r aria-hidden=3D"true"> =E2=80=A2 spannende Digital- &amp; Medienprojekte (=
u. a. =C3=B6ffentlicher Bereich) <br aria-hidden=3D"true"> =E2=80=A2 modern=
es Tech-Setup mit Fokus auf Qualit=C3=A4t &amp; saubere Prozesse <br aria-h=
idden=3D"true"> <br aria-hidden=3D"true"> =F0=9F=9B=A0 Tech-Stack (Kernanfo=
rderungen): <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> =E2=80=A2 J=
ava (Senior-Level) <br aria-hidden=3D"true"> =E2=80=A2 Sophora CMS <br aria=
-hidden=3D"true"> =E2=80=A2 Spring, Maven, Git <br aria-hidden=3D"true"> =
=E2=80=A2 APIs (GraphQL / REST) <br aria-hidden=3D"true"> =E2=80=A2 Docker =
/ Kubernetes <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> Falls du d=
erzeit grunds=C3=A4tzlich offen f=C3=BCr einen Wechsel bist, freue ich mich=
 =C3=BCber, wenn wir einmal miteinander telefonieren: https://calendar.app.=
google/BBy3H8wgRbYY7VR2A <br aria-hidden=3D"true"> <br aria-hidden=3D"true"=
> Ich freue mich auf deine R=C3=BCckmeldung - auch dann, wenn es derzeit ni=
cht spannend ist, w=C3=BCsste ich ein kurzes Feedback sehr zu sch=C3=A4tzen=
! <br aria-hidden=3D"true"> <br aria-hidden=3D"true"> Viele Gr=C3=BC=C3=9Fe=
 <br aria-hidden=3D"true"> Shira <br aria-hidden=3D"true"> <br aria-hidden=
=3D"true"> =F0=9F=93=A7 shira@tech-recruiting.de <br aria-hidden=3D"true"> =
=F0=9F=93=9E +49 159 01375281 <br aria-hidden=3D"true"> =F0=9F=8C=90 fahren=
bergrecruitingsolutions.com <br aria-hidden=3D"true"> <br aria-hidden=3D"tr=
ue"> Shira Fahrenberg | Founder Senior Tech Recruiter <br aria-hidden=3D"tr=
ue"> </td> </tr> <tr> <td class=3D"pt-2 pb-2" style=3D"-webkit-text-size-ad=
just: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rs=
pace: 0pt; padding-bottom: 16px; padding-top: 16px;"> <table role=3D"presen=
tation" valign=3D"top" border=3D"0" cellspacing=3D"0" cellpadding=3D"0" wid=
th=3D"100%" class=3D"email-button " data-test-id=3D"email-button" style=3D"=
-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspac=
e: 0pt; mso-table-rspace: 0pt;"> <tbody> <tr> <td valign=3D"middle" align=
=3D"left" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 10=
0%; mso-table-lspace: 0pt; mso-table-rspace: 0pt;"> <a href=3D"https://www.=
linkedin.com/comm/messaging/thread/2-N2M3MmEwNDMtZDU4YS00NWEyLTkyOWMtNzI2Mz=
AxYzZjNGY1XzEwMA=3D=3D/?lipi=3Durn%3Ali%3Apage%3Aemail_email_hire_inmail_in=
itial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midToken=3DAQFM61JoD1kdc=
A&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-email_hire_inmail_initial_singl=
e_01-inmail-0-view_message&amp;trkEmail=3Deml-email_hire_inmail_initial_sin=
gle_01-inmail-0-view_message-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dck=
bds4-mkpcueqa-t4" target=3D"_blank" aria-label=3D"View message" class=3D"al=
ign-top no-underline " style=3D"color: #0a66c2; cursor: pointer; display: i=
nline-block; text-decoration: none; -webkit-text-size-adjust: 100%; -ms-tex=
t-size-adjust: 100%; vertical-align: top; text-decoration-line: none;"> <ta=
ble role=3D"presentation" valign=3D"top" border=3D"0" cellspacing=3D"0" cel=
lpadding=3D"0" width=3D"auto" class=3D"border-separate " style=3D"-webkit-t=
ext-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; m=
so-table-rspace: 0pt; border-collapse: separate;"> <tbody> <tr> <td class=
=3D"btn-md btn-primary border-color-brand button-link leading-regular !min-=
h-[auto] !shadow-none border-1 border-solid" style=3D"-webkit-text-size-adj=
ust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rsp=
ace: 0pt; height: min-content; border-radius: 24px; padding-top: 12px; padd=
ing-bottom: 12px; padding-left: 24px; padding-right: 24px; text-align: cent=
er; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration-lin=
e: none; background-color: #0a66c2; color: #ffffff; border-width: 1px; bord=
er-style: solid; border-color: #0a66c2; line-height: 1.25; min-height: auto=
 !important; box-shadow: 0 0 #0000, 0 0 #0000, 0 0 #0000 !important;"> <a h=
ref=3D"https://www.linkedin.com/comm/messaging/thread/2-N2M3MmEwNDMtZDU4YS0=
0NWEyLTkyOWMtNzI2MzAxYzZjNGY1XzEwMA=3D=3D/?lipi=3Durn%3Ali%3Apage%3Aemail_e=
mail_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midTo=
ken=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-email_hire_i=
nmail_initial_single_01-inmail-0-view_message&amp;trkEmail=3Deml-email_hire=
_inmail_initial_single_01-inmail-0-view_message-null-ckbds4~mkpcueqa~t4-nul=
l-null&amp;eid=3Dckbds4-mkpcueqa-t4" target=3D"_blank" tabindex=3D"-1" aria=
-hidden=3D"true" class=3D"no-underline" style=3D"color: #0a66c2; cursor: po=
inter; display: inline-block; text-decoration: none; -webkit-text-size-adju=
st: 100%; -ms-text-size-adjust: 100%; text-decoration-line: none;"> <span c=
lass=3D"no-underline text-white" style=3D"color: #ffffff; text-decoration-l=
ine: none;"> View message </span> </a> </td> </tr> </tbody> </table> </a> <=
/td> </tr> </tbody> </table> </td> </tr> <tr> <td class=3D"pt-2 pb-2" style=
=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-l=
space: 0pt; mso-table-rspace: 0pt; padding-bottom: 16px; padding-top: 16px;=
"> </td> </tr> <tr> <td class=3D"pt-2 text-md text-cool-gray-80" style=3D"-=
webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace=
: 0pt; mso-table-rspace: 0pt; padding-top: 16px; font-size: 16px; color: #3=
8434f;"> <b>Notice:</b> <a href=3D"https://www.linkedin.com/help/linkedin/a=
nswer/a7134286" title=3D"Learn more" style=3D"color: #0a66c2; cursor: point=
er; display: inline-block; text-decoration: none; -webkit-text-size-adjust:=
 100%; -ms-text-size-adjust: 100%;">Learn more</a> about how we use your da=
ta in AI-assisted features connecting recruiters with potential candidates.=
 </td> </tr> </tbody> </table> </div> </td> </tr> <tr> <td class=3D"bg-colo=
r-background-canvas p-3" style=3D"-webkit-text-size-adjust: 100%; -ms-text-=
size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; background=
-color: #f3f2f0; padding: 24px;"> <table role=3D"presentation" valign=3D"to=
p" border=3D"0" cellspacing=3D"0" cellpadding=3D"0" width=3D"100%" class=3D=
"text-xs" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 10=
0%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; font-size: 12px;"> <tbody=
> <tr> <td class=3D"pb-1 m-0" data-test-id=3D"email-footer__intended" style=
=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-l=
space: 0pt; mso-table-rspace: 0pt; margin: 0px; padding-bottom: 8px;"> This=
 email was intended for Paul Wellner Bou (Software Architect, Full-Stack De=
veloper, Tech-Lead) </td> </tr> <tr> <td class=3D"pb-1 m-0" style=3D"-webki=
t-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt=
; mso-table-rspace: 0pt; margin: 0px; padding-bottom: 8px;"> <a href=3D"htt=
ps://www.linkedin.com/help/linkedin/answer/4788?lang=3Den&amp;lipi=3Durn%3A=
li%3Apage%3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9Sd=
mjA%3D%3D&amp;midToken=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=
=3Deml-email_hire_inmail_initial_single_01-SecurityHelp-0-footerglimmer&amp=
;trkEmail=3Deml-email_hire_inmail_initial_single_01-SecurityHelp-0-footergl=
immer-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dckbds4-mkpcueqa-t4" targe=
t=3D"_blank" class=3D"text-inherit underline" style=3D"cursor: pointer; dis=
play: inline-block; text-decoration: none; -webkit-text-size-adjust: 100%; =
-ms-text-size-adjust: 100%; color: inherit; text-decoration-line: underline=
;">Learn why we included this.</a> </td> </tr> <tr> <td class=3D"pb-1 m-0" =
style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-ta=
ble-lspace: 0pt; mso-table-rspace: 0pt; margin: 0px; padding-bottom: 8px;">=
You are receiving LinkedIn notification emails.</td> </tr> <tr> <td class=
=3D"pb-1 m-0" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adjust=
: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; margin: 0px; padding-=
bottom: 8px;"> <a href=3D"https://www.linkedin.com/comm/psettings/email-uns=
ubscribe?lipi=3Durn%3Ali%3Apage%3Aemail_email_hire_inmail_initial_single_01=
%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midToken=3DAQFM61JoD1kdcA&amp;midSig=3D=
19LGmoAfG2VI41&amp;trk=3Deml-email_hire_inmail_initial_single_01-unsubscrib=
e-0-footerGlimmer&amp;trkEmail=3Deml-email_hire_inmail_initial_single_01-un=
subscribe-0-footerGlimmer-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dckbds=
4-mkpcueqa-t4&amp;loid=3DAQGszkRNExwd1QAAAZvlafblMjtWo52qrQvgR0d1o3aWGw8NBZ=
gDjN0xs1aYdijSqvzRsiKz8upzaoOpdlMxNEzOiMx3bbc" target=3D"_blank" class=3D"t=
ext-inherit underline" style=3D"cursor: pointer; display: inline-block; tex=
t-decoration: none; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 1=
00%; color: inherit; text-decoration-line: underline;">Unsubscribe</a> =C2=
=A0=C2=A0=C2=B7=C2=A0=C2=A0 <a href=3D"https://www.linkedin.com/help/linked=
in/answer/67?lang=3Den&amp;lipi=3Durn%3Ali%3Apage%3Aemail_email_hire_inmail=
_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&amp;midToken=3DAQFM61JoD1=
kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-email_hire_inmail_initial_si=
ngle_01-help-0-footerglimmer&amp;trkEmail=3Deml-email_hire_inmail_initial_s=
ingle_01-help-0-footerglimmer-null-ckbds4~mkpcueqa~t4-null-null&amp;eid=3Dc=
kbds4-mkpcueqa-t4" target=3D"_blank" data-test-help-link class=3D"text-inhe=
rit underline" style=3D"cursor: pointer; display: inline-block; text-decora=
tion: none; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; col=
or: inherit; text-decoration-line: underline;">Help</a> </td> </tr> <tr> <t=
d class=3D"pb-1" style=3D"-webkit-text-size-adjust: 100%; -ms-text-size-adj=
ust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; padding-bottom: 8p=
x;"> <a href=3D"https://www.linkedin.com/comm/feed/?lipi=3Durn%3Ali%3Apage%=
3Aemail_email_hire_inmail_initial_single_01%3BcOxfViPFQIipGy2H9SdmjA%3D%3D&=
amp;midToken=3DAQFM61JoD1kdcA&amp;midSig=3D19LGmoAfG2VI41&amp;trk=3Deml-ema=
il_hire_inmail_initial_single_01-footer-0-logoGlimmer&amp;trkEmail=3Deml-em=
ail_hire_inmail_initial_single_01-footer-0-logoGlimmer-null-ckbds4~mkpcueqa=
~t4-null-null&amp;eid=3Dckbds4-mkpcueqa-t4" target=3D"_blank" style=3D"colo=
r: #0a66c2; cursor: pointer; display: inline-block; text-decoration: none; =
-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;"> <img src=3D"h=
ttps://static.licdn.com/aero-v1/sc/h/9ehe6n39fa07dc5edzv0rla4e" alt=3D"Link=
edIn" class=3D"block h-[14px] w-[56px] image-rendering-crisp" style=3D"outl=
ine: none; text-decoration: none; image-rendering: -moz-crisp-edges; image-=
rendering: -o-crisp-edges; image-rendering: -webkit-optimize-contrast; imag=
e-rendering: crisp-edges; -ms-interpolation-mode: nearest-neighbor; display=
: block; height: 14px; width: 56px;" width=3D"56" height=3D"14"> </a> </td>=
 </tr> <tr> <td data-test-copyright-text style=3D"-webkit-text-size-adjust:=
 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace:=
 0pt;"> =C2=A9 2026 LinkedIn Corporation, 1&zwnj;000 West Maude Avenue, Sun=
nyvale, CA 94085. <span data-test-trademarks-text> LinkedIn and the LinkedI=
n logo are registered trademarks of LinkedIn. </span> </td> </tr> </tbody> =
</table> </td> </tr> </tbody> </table> </td> </tr> </tbody> </table> <img a=
lt role=3D"presentation" src=3D"https://www.linkedin.com/emimp/ip_WTJ0aVpIT=
TBMVzFyY0dOMVpYRmhMWFEwOlpXMWhhV3hmYUdseVpWOXBibTFoYVd4ZmFXNXBkR2xoYkY5emFX=
NW5iR1ZmTURFPTo=3D.gif" style=3D"outline: none; text-decoration: none; -ms-=
interpolation-mode: bicubic; width: 1px; height: 1px;" width=3D"1" height=
=3D"1"> </body> </html>
------=_Part_31643460_1988832987.1769080486173--

```
