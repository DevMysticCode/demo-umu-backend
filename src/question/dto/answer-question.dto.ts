import { IsDefined } from 'class-validator';

// `value` is intentionally untyped — question answers can be a string,
// number, boolean, object (ADDRESS/MULTIFIELDFORM), or array (CHECKBOX/
// CHIPS) depending on the question's QuestionType. Only presence is
// enforced here; per-type shape validation happens in QuestionService.
export class AnswerQuestionDto {
  @IsDefined()
  value: any;
}
