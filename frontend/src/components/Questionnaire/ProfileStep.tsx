import { useState } from "react";
import type { BusinessProfile } from "../../types";
import "./Questionnaire.css";
import "./ProfileStep.css";

interface ProfileStepProps {
  onGenerate: (profile: BusinessProfile) => void;
  generating: boolean;
  error: string | null;
}

interface FieldSpec {
  key: keyof BusinessProfile;
  label: string;
  placeholder: string;
}

const PROFILE_FIELDS: FieldSpec[] = [
  { key: "company_name", label: "项目/品牌名称", placeholder: "如：华火新能源电火灶项目" },
  { key: "industry", label: "所属行业", placeholder: "如：直播电商、钢铁制造、SaaS软件" },
  { key: "main_business", label: "主营业务", placeholder: "如：为中小制造企业提供智能排产系统" },
  { key: "business_model", label: "商业模式", placeholder: "如：订阅制 SaaS、按项目交付、批发分销" },
  { key: "scale", label: "规模", placeholder: "如：员工58人，年营收1200万元" },
  { key: "stage", label: "发展阶段", placeholder: "如：初创验证期、快速扩张期、成熟稳定期" },
];

const EMPTY: BusinessProfile = {
  company_name: "",
  industry: "",
  main_business: "",
  business_model: "",
  scale: "",
  stage: "",
};

export function ProfileStep({ onGenerate, generating, error }: ProfileStepProps) {
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY);

  const setField = (key: keyof BusinessProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="questionnaire">
      <section className="wizard-card">
        <header className="module-head">
          <h2 className="module-head__title">先了解你的项目</h2>
          <p className="module-head__subtitle">
            我们将据此为你定制诊断问卷，让每个问题都贴合你的业务
          </p>
        </header>

        <div className="fields-grid">
          {PROFILE_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label className="field__label" htmlFor={`profile-${f.key}`}>
                {f.label}
              </label>
              <input
                id={`profile-${f.key}`}
                className="field__input"
                type="text"
                placeholder={f.placeholder}
                value={profile[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>

        {error && <p className="profile-error">{error}</p>}

        <div className="profile-action">
          <button
            type="button"
            className="btn-primary btn-primary--final profile-generate"
            disabled={generating}
            onClick={() => onGenerate(profile)}
          >
            {generating ? "正在生成问卷…" : "生成专属问卷"}
          </button>
        </div>
      </section>
    </div>
  );
}
