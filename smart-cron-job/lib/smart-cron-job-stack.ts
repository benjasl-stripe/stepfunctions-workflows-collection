import { Duration, Stack, StackProps,   aws_lambda as lambda, Aws,  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
  aws_dynamodb,
} from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class SmartCronJobStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const waitState = new sfn.Wait(this, "Wait until timestamp", {
      time: sfn.WaitTime.timestampPath("$.timestamp"),
    });

    const passState = new sfn.Pass(this, 'PassState');

    const waitToStartEventWorkflow = new sfn.StateMachine(this, "WaitEventInnerSF",{
        definition: passState,
      }
    );

    const mainState = new tasks.StepFunctionsStartExecution(this,"MainState",{
        stateMachine: waitToStartEventWorkflow,
        integrationPattern: sfn.IntegrationPattern.RUN_JOB,
        outputPath: "$.Output",
      }
    );

    const stepFunction = new sfn.StateMachine(this, "SchedulerSF", {
      definition: waitState.next(mainState),
    });


    // scheduled events DynamoDB table
    const eventsTable = new aws_dynamodb.Table(this, "scheduledEvents", {
      partitionKey: {
        name: "eventDate",
        type: aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "eventId",
        type: aws_dynamodb.AttributeType.STRING,
      },
      billingMode: aws_dynamodb.BillingMode.PAY_PER_REQUEST,
    });



    //Lambda function to run the scheduled task
    const scheduler = new lambda.Function(this,"Scheduler",{
        runtime: lambda.Runtime.NODEJS_16_X,
        code: lambda.Code.fromAsset("lambda"),
        handler: "index.handler",
        environment: {
          SF_ARN: stepFunction.stateMachineArn,
          TABLE_NAME: eventsTable.tableName
        },
      }
    );

    eventsTable.grantReadData(scheduler);
    stepFunction.grantStartExecution(scheduler);


    const cronRule = new Rule(this, "CronRule", {
      schedule: Schedule.expression("cron(01 0 ? * MON-FRI *)"),
    });

    //Set Lambda function as target for EventBridge
    cronRule.addTarget(new LambdaFunction(scheduler));




  }
}
